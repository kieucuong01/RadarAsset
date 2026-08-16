#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

if [[ "${EUID}" -ne 0 ]]; then
  echo "provision_status=root_required" >&2
  exit 1
fi

deepseek_env=""
s3_env=""
dry_run=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deepseek-env-file)
      deepseek_env="${2:-}"
      shift 2
      ;;
    --s3-env-file)
      s3_env="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    *)
      echo "provision_status=invalid_argument" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${deepseek_env}" || -z "${s3_env}" ]]; then
  echo "provision_status=missing_env_path" >&2
  exit 2
fi

deepseek_env="$(realpath -- "${deepseek_env}")"
s3_env="$(realpath -- "${s3_env}")"
case "${deepseek_env}" in
  /opt/lasotinhhoa/*) ;;
  *) echo "provision_status=invalid_deepseek_path" >&2; exit 2 ;;
esac
case "${s3_env}" in
  /opt/radar-bds/*) ;;
  *) echo "provision_status=invalid_s3_path" >&2; exit 2 ;;
esac
[[ -f "${deepseek_env}" && -f "${s3_env}" ]] || {
  echo "provision_status=env_file_missing" >&2
  exit 2
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
helper="${script_dir}/provision_datavest.py"
template="${script_dir}/env.production.example"
[[ -f "${helper}" && -f "${template}" ]] || {
  echo "provision_status=release_files_missing" >&2
  exit 1
}

if [[ "${dry_run}" == true ]]; then
  python3 - "${deepseek_env}" "${s3_env}" "${script_dir}" <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, sys.argv[3])
from datavest_env import read_env_file
deepseek = read_env_file(Path(sys.argv[1]))
s3 = read_env_file(Path(sys.argv[2]))
required = {
    "deepseek": all(deepseek.get(name, "").strip() for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_MODEL")),
    "s3": all(s3.get(name, "").strip() for name in ("RADAR_S3_ENDPOINT_URL", "RADAR_S3_ACCESS_KEY_ID", "RADAR_S3_SECRET_ACCESS_KEY")),
}
for name, configured in required.items():
    print(f"{name}_configured={str(configured).lower()}")
raise SystemExit(0 if all(required.values()) else 1)
PY
  echo "provision_status=dry_run_ok"
  exit 0
fi

getent group datavest >/dev/null || groupadd --system datavest
id -u datavest >/dev/null 2>&1 || useradd \
  --system --gid datavest --home-dir /opt/datavest --shell /usr/sbin/nologin datavest
id -u datavest-deploy >/dev/null 2>&1 || useradd \
  --create-home --shell /bin/bash datavest-deploy
passwd --lock datavest-deploy >/dev/null
command -v setfacl >/dev/null || {
  echo "provision_status=setfacl_missing" >&2
  exit 1
}

install -d -o root -g datavest -m 0750 /opt/datavest
setfacl -m u:datavest-deploy:--x /opt/datavest
install -d -o root -g datavest -m 0750 /opt/datavest/releases
install -d -o datavest-deploy -g datavest -m 2750 /opt/datavest/incoming
install -d -o root -g datavest -m 0750 /opt/datavest/shared
install -d -o datavest -g datavest -m 0750 /opt/datavest/shared/spool
install -d -o datavest -g datavest -m 0700 /opt/datavest/shared/spool/backups
install -d -o root -g datavest -m 0750 /opt/datavest/logs
install -d -o root -g root -m 0755 /usr/local/libexec/datavest

temporary_env="$(mktemp /opt/datavest/shared/.env.provision.XXXXXX)"
cleanup() {
  rm -f -- "${temporary_env}"
}
trap cleanup EXIT

python3 "${helper}" render-env \
  --template "${template}" \
  --existing /opt/datavest/shared/.env \
  --deepseek-env "${deepseek_env}" \
  --s3-env "${s3_env}" \
  --output "${temporary_env}"
python3 "${helper}" provision-db --env-file "${temporary_env}"
install -o root -g datavest -m 0640 "${temporary_env}" /opt/datavest/shared/.env

install -o root -g root -m 0755 "${script_dir}/datavest_env.py" /usr/local/libexec/datavest/datavest_env.py
install -o root -g root -m 0755 "${helper}" /usr/local/libexec/datavest/provision_datavest.py
for unit in \
  datavest-web.service \
  datavest-quant-engine.service \
  datavest-worker.service \
  datavest-job@.service \
  datavest-postgres-backup.service \
  datavest-postgres-backup.timer \
  datavest-market-daily.timer \
  datavest-smart-four-hourly.timer \
  datavest-smart-daily.timer \
  datavest-smart-weekly.timer \
  datavest-calendar-current.timer \
  datavest-calendar-next.timer \
  datavest-briefing.timer; do
  install -o root -g root -m 0644 "${script_dir}/systemd/${unit}" "/etc/systemd/system/${unit}"
done

if [[ -f "${script_dir}/deploy-datavest.sh" ]]; then
  install -o root -g root -m 0755 "${script_dir}/deploy-datavest.sh" /usr/local/sbin/deploy-datavest
  printf '%s\n' \
    'datavest-deploy ALL=(root) NOPASSWD: /usr/local/sbin/deploy-datavest' \
    > /etc/sudoers.d/datavest-deploy
  chmod 0440 /etc/sudoers.d/datavest-deploy
  visudo -cf /etc/sudoers.d/datavest-deploy >/dev/null
fi

if [[ -f "${script_dir}/run-scheduled-job.sh" ]]; then
  install -o root -g root -m 0755 \
    "${script_dir}/run-scheduled-job.sh" \
    /usr/local/libexec/datavest/run-scheduled-job
fi

if [[ -f "${script_dir}/backup-postgres.py" ]]; then
  install -o root -g root -m 0755 \
    "${script_dir}/backup-postgres.py" \
    /usr/local/libexec/datavest/backup-postgres.py
fi

if [[ -f "${script_dir}/verify-s3-access.py" ]]; then
  install -o root -g root -m 0755 \
    "${script_dir}/verify-s3-access.py" \
    /usr/local/libexec/datavest/verify-s3-access.py
fi

if [[ -f "${script_dir}/nginx/datavest.conf" ]]; then
  install -o root -g root -m 0644 \
    "${script_dir}/nginx/datavest.conf" \
    /etc/nginx/sites-available/datavest.conf
fi

systemctl daemon-reload
echo "provision_status=ok"
