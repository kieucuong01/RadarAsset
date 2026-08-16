#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

readonly production_root="/opt/datavest"
test_mode=false

if [[ "${1:-}" == "--validate-only" ]]; then
  if [[ "${EUID}" -eq 0 ]]; then
    echo "deploy_status=test_mode_forbidden_as_root" >&2
    exit 2
  fi
  [[ $# -eq 4 ]] || { echo "deploy_status=invalid_arguments" >&2; exit 2; }
  test_mode=true
  datavest_root="$(realpath -- "$2")"
  archive_argument="$3"
  git_sha="$4"
else
  [[ "${EUID}" -ne 0 ]] && { echo "deploy_status=root_required" >&2; exit 1; }
  [[ $# -eq 2 ]] || { echo "deploy_status=invalid_arguments" >&2; exit 2; }
  datavest_root="${production_root}"
  archive_argument="$1"
  git_sha="$2"
  exec 9>/run/lock/datavest-deploy.lock
  if ! flock -n 9; then
    echo "deploy_status=already_running" >&2
    exit 1
  fi
fi

readonly incoming_root="${datavest_root}/incoming"
readonly releases_root="${datavest_root}/releases"
readonly shared_root="${datavest_root}/shared"
readonly current_link="${datavest_root}/current"
readonly previous_link="${datavest_root}/previous"

[[ "${git_sha}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "deploy_status=invalid_git_sha" >&2
  exit 2
}
[[ -d "${incoming_root}" && -d "${releases_root}" ]] || {
  echo "deploy_status=layout_missing" >&2
  exit 1
}

[[ -f "${archive_argument}" && ! -L "${archive_argument}" ]] || {
  echo "deploy_status=archive_invalid" >&2
  exit 2
}
archive="$(realpath -- "${archive_argument}")"
archive_name="$(basename -- "${archive}")"
[[ "$(dirname -- "${archive}")" == "$(realpath -- "${incoming_root}")" ]] || {
  echo "deploy_status=archive_outside_incoming" >&2
  exit 2
}
[[ "${archive_name}" == "datavest-release-${git_sha:0:12}.tar.gz" ]] || {
  echo "deploy_status=archive_identity_mismatch" >&2
  exit 2
}

checksum_argument="${archive}.sha256"
[[ -f "${checksum_argument}" && ! -L "${checksum_argument}" ]] || {
  echo "deploy_status=checksum_invalid" >&2
  exit 2
}
checksum="$(realpath -- "${checksum_argument}")"
[[ "$(dirname -- "${checksum}")" == "$(realpath -- "${incoming_root}")" ]] || {
  echo "deploy_status=checksum_outside_incoming" >&2
  exit 2
}
mapfile -t checksum_lines < "${checksum}"
archive_digest="$(sha256sum "${archive}" | awk '{print $1}')"
[[ ${#checksum_lines[@]} -eq 1 && "${checksum_lines[0]}" == "${archive_digest}  ${archive_name}" ]] || {
  echo "deploy_status=checksum_format_invalid" >&2
  exit 2
}
(
  cd -- "${incoming_root}"
  sha256sum -c "$(basename -- "${checksum}")" >/dev/null
)

archive_list="$(mktemp "${TMPDIR:-/tmp}/datavest-archive.XXXXXX")"
release_dir=""
python_stage=""
migration_stage=""
release_committed=false
cleanup() {
  rm -f -- "${archive_list}"
  for dependency_stage in "${python_stage}" "${migration_stage}"; do
    if [[ -n "${dependency_stage}" && -e "${dependency_stage}" ]]; then
      case "$(realpath -- "${dependency_stage}")" in
        "$(realpath -- "${shared_root}/dependencies")"/*) rm -rf -- "${dependency_stage}" ;;
        *) echo "deploy_status=unsafe_dependency_cleanup_blocked" >&2 ;;
      esac
    fi
  done
  if [[ -n "${release_dir}" && "${release_committed}" == false && -d "${release_dir}" ]]; then
    case "$(realpath -- "${release_dir}")" in
      "$(realpath -- "${releases_root}")"/*) rm -rf -- "${release_dir}" ;;
      *) echo "deploy_status=unsafe_cleanup_blocked" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

tar -tzf "${archive}" > "${archive_list}"
entry_count=0
while IFS= read -r entry; do
  entry_count=$((entry_count + 1))
  normalized="${entry%/}"
  [[ "${normalized}" == "release" || "${normalized}" == release/* ]] || {
    echo "deploy_status=archive_path_invalid" >&2
    exit 2
  }
  IFS='/' read -r -a components <<< "${normalized}"
  for component in "${components[@]}"; do
    [[ "${component}" != ".." && -n "${component}" ]] || {
      echo "deploy_status=archive_path_invalid" >&2
      exit 2
    }
  done
done < "${archive_list}"
[[ ${entry_count} -gt 0 ]] || { echo "deploy_status=archive_empty" >&2; exit 2; }
if tar -tvzf "${archive}" | awk 'substr($0, 1, 1) ~ /[lhbcps]/ { found=1 } END { exit !found }'; then
  echo "deploy_status=archive_link_or_special_file" >&2
  exit 2
fi

archive_bytes="$(stat -c '%s' -- "${archive}")"
uncompressed_bytes="$(gzip -l -- "${archive}" | awk 'NR == 2 {print $2}')"
[[ "${archive_bytes}" =~ ^[0-9]+$ && "${uncompressed_bytes}" =~ ^[0-9]+$ ]] || {
  echo "deploy_status=archive_size_invalid" >&2
  exit 2
}
required_kb=$(( (archive_bytes + uncompressed_bytes + 1023) / 1024 + 1048576 ))
if [[ "${test_mode}" == true ]]; then
  available_kb="${DATAVEST_TEST_AVAILABLE_KB:-}"
  [[ "${available_kb}" =~ ^[0-9]+$ ]] || { echo "deploy_status=test_disk_invalid" >&2; exit 2; }
else
  available_kb="$(df -Pk -- "${datavest_root}" | awk 'NR == 2 {print $4}')"
fi
(( available_kb >= required_kb )) || { echo "deploy_status=insufficient_disk" >&2; exit 1; }

if [[ "${test_mode}" == true ]]; then
  release_id="validate-${BASHPID}"
else
  release_id="$(date -u +%Y%m%dT%H%M%SZ)-${git_sha:0:12}"
fi
release_dir="${releases_root}/${release_id}"
[[ ! -e "${release_dir}" ]] || { echo "deploy_status=release_exists" >&2; exit 1; }
mkdir -- "${release_dir}"
chmod 0750 "${release_dir}"
tar -C "${release_dir}" --strip-components=1 --no-same-owner --no-same-permissions -xzf "${archive}"

node_bin="$(command -v node || true)"
[[ -n "${node_bin}" ]] || { echo "deploy_status=node_missing" >&2; exit 1; }
"${node_bin}" - "${release_dir}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[2]);
const manifest = fs.readFileSync(path.join(root, "manifest.sha256"), "utf8");
for (const line of manifest.trimEnd().split("\n")) {
  const match = line.match(/^([0-9a-f]{64})  ([^\r\n]+)$/);
  if (!match) throw new Error("Invalid manifest line.");
  const relative = match[2];
  const resolved = path.resolve(root, relative);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Manifest path escapes release root.");
  }
}
const metadata = JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8"));
for (const field of ["gitSha", "requirementsHash", "migrationToolingHash"]) {
  const length = field === "gitSha" ? 40 : 64;
  if (typeof metadata[field] !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(metadata[field])) {
    throw new Error(`Invalid ${field}.`);
  }
}
NODE
(
  cd -- "${release_dir}"
  sha256sum -c manifest.sha256 >/dev/null
)
release_sha="$("${node_bin}" -p "require(process.argv[1]).gitSha" "${release_dir}/release.json")"
[[ "${release_sha}" == "${git_sha}" ]] || { echo "deploy_status=release_sha_mismatch" >&2; exit 2; }

if [[ "${test_mode}" == true ]]; then
  echo "deploy_status=validated"
  exit 0
fi

chown -R root:datavest "${release_dir}"
chmod -R u+rwX,g+rX,o-rwx "${release_dir}"
install -d -o root -g datavest -m 0750 "${shared_root}/dependencies"

requirements_hash="$("${node_bin}" -p "require(process.argv[1]).requirementsHash" "${release_dir}/release.json")"
migration_hash="$("${node_bin}" -p "require(process.argv[1]).migrationToolingHash" "${release_dir}/release.json")"
python_target="${shared_root}/dependencies/python-${requirements_hash}"
migration_target="${shared_root}/dependencies/migration-${migration_hash}"

if [[ ! -d "${python_target}" ]]; then
  python_stage="${shared_root}/dependencies/.python-${requirements_hash}.${BASHPID}"
  python3 -m venv "${python_stage}"
  "${python_stage}/bin/python" -m pip install --no-index \
    --find-links "${release_dir}/wheelhouse" \
    -r "${release_dir}/quant-worker/requirements.txt"
  "${python_stage}/bin/python" -c "import fastapi, psycopg, boto3"
  mv -T -- "${python_stage}" "${python_target}"
fi

if [[ ! -d "${migration_target}" ]]; then
  migration_stage="${shared_root}/dependencies/.migration-${migration_hash}.${BASHPID}"
  install -d -m 0750 "${migration_stage}"
  cp -a -- "${release_dir}/migration-tooling/." "${migration_stage}/"
  "${node_bin}" "${migration_stage}/node_modules/prisma/build/index.js" --version >/dev/null
  mv -T -- "${migration_stage}" "${migration_target}"
fi

old_python_target="$(readlink -f -- "${shared_root}/python-venv" 2>/dev/null || true)"
old_migration_target="$(readlink -f -- "${shared_root}/migration-tooling" 2>/dev/null || true)"
switch_link() {
  local target="$1" link="$2" temporary="${2}.next.${BASHPID}"
  ln -s -- "${target}" "${temporary}" && mv -Tf -- "${temporary}" "${link}"
}
restore_link() {
  local target="$1" link="$2"
  if [[ -n "${target}" ]]; then
    switch_link "${target}" "${link}"
  else
    rm -f -- "${link}"
  fi
}

database_url="$(python3 - "${shared_root}/.env" <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, "/usr/local/libexec/datavest")
from datavest_env import read_env_file
value = read_env_file(Path(sys.argv[1])).get("DATABASE_URL", "")
if not value:
    raise SystemExit(1)
print(value, end="")
PY
)"
echo "deploy_step=prisma migrate deploy"
DATABASE_URL="${database_url}" DATAVEST_RELEASE_SHA="${git_sha}" \
  "${node_bin}" "${migration_target}/node_modules/prisma/build/index.js" \
  migrate deploy --schema "${release_dir}/prisma/schema.prisma"
unset database_url

old_current="$(readlink -f -- "${current_link}" 2>/dev/null || true)"
old_release_sha=""
if [[ -n "${old_current}" && -f "${old_current}/release.json" ]]; then
  old_release_sha="$("${node_bin}" -p "require(process.argv[1]).gitSha" "${old_current}/release.json")"
fi

write_release_env() {
  local sha="$1" temporary
  temporary="$(mktemp "${shared_root}/.release.env.XXXXXX")"
  printf 'DATAVEST_RELEASE_SHA=%s\n' "${sha}" > "${temporary}"
  chown root:datavest "${temporary}"
  chmod 0640 "${temporary}"
  mv -Tf -- "${temporary}" "${shared_root}/release.env"
}

restart_services() {
  systemctl restart datavest-quant-engine.service
  systemctl restart datavest-worker.service
  systemctl restart datavest-web.service
}

wait_for_url() {
  local url="$1" max_time="$2"
  for _attempt in {1..12}; do
    if curl --fail --silent --show-error --max-time "${max_time}" "${url}" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback_release() {
  trap - ERR
  set +e
  if [[ -n "${old_current}" ]]; then
    switch_link "${old_current}" "${current_link}"
    write_release_env "${old_release_sha}"
    restore_link "${old_python_target}" "${shared_root}/python-venv"
    restore_link "${old_migration_target}" "${shared_root}/migration-tooling"
    restart_services
    wait_for_url "http://127.0.0.1:8200/healthz" 10
    wait_for_url "http://127.0.0.1:4200/api/health/ready" 10
  else
    rm -f -- "${current_link}" "${shared_root}/release.env"
    systemctl stop datavest-web.service datavest-worker.service datavest-quant-engine.service
  fi
  echo "deploy_status=rolled_back" >&2
}

on_error() {
  local status=$?
  trap - ERR
  set +e
  if [[ "${switched:-false}" == true ]]; then
    rollback_release
  elif [[ "${dependencies_switched:-false}" == true ]]; then
    restore_link "${old_python_target}" "${shared_root}/python-venv"
    restore_link "${old_migration_target}" "${shared_root}/migration-tooling"
  fi
  exit "${status}"
}
switched=false
dependencies_switched=false
trap on_error ERR

switch_link "${migration_target}" "${shared_root}/migration-tooling"
dependencies_switched=true
switch_link "${python_target}" "${shared_root}/python-venv"
if [[ -n "${old_current}" ]]; then
  switch_link "${old_current}" "${previous_link}"
else
  rm -f -- "${previous_link}"
fi
switch_link "${release_dir}" "${current_link}"
switched=true
write_release_env "${git_sha}"

restart_services
wait_for_url "http://127.0.0.1:8200/healthz" 10
wait_for_url "http://127.0.0.1:4200/api/health/ready" 10
wait_for_url "https://datavest.vn/api/health/ready" 15
systemctl enable datavest-quant-engine.service datavest-worker.service datavest-web.service >/dev/null

printf '%s\n' "${requirements_hash}" > "${shared_root}/requirements.sha256"
printf '%s\n' "${migration_hash}" > "${shared_root}/migration-tooling.sha256"
chown root:datavest "${shared_root}/requirements.sha256" "${shared_root}/migration-tooling.sha256"
chmod 0640 "${shared_root}/requirements.sha256" "${shared_root}/migration-tooling.sha256"
release_committed=true
switched=false
trap - ERR

active_target="$(realpath -- "${current_link}")"
rollback_target="$(realpath -- "${previous_link}" 2>/dev/null || true)"
while IFS= read -r -d '' candidate; do
  resolved_candidate="$(realpath -- "${candidate}")"
  case "${resolved_candidate}" in
    "$(realpath -- "${releases_root}")"/*) ;;
    *) echo "deploy_status=unsafe_prune_blocked" >&2; exit 1 ;;
  esac
  if [[ "${resolved_candidate}" != "${active_target}" && "${resolved_candidate}" != "${rollback_target}" ]]; then
    rm -rf -- "${resolved_candidate}"
  fi
done < <(find "${releases_root}" -mindepth 1 -maxdepth 1 -type d -print0)

rm -f -- "${archive}" "${checksum}"
echo "deploy_status=ok release_id=${release_id} git_sha=${git_sha}"
