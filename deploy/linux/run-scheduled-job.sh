#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

readonly python_bin="/opt/datavest/shared/python-venv/bin/python"
readonly worker_root="/opt/datavest/current/quant-worker"
readonly env_file="/opt/datavest/shared/.env"
readonly lock_file="/run/lock/datavest-heavy-jobs.lock"

list_jobs() {
  printf '%s\n' \
    market-daily \
    smart-four-hourly \
    smart-daily \
    smart-weekly \
    calendar-current \
    calendar-next \
    briefing
}

if [[ "${1:-}" == "--list" && $# -eq 1 ]]; then
  list_jobs
  exit 0
fi

print_only=false
if [[ "${1:-}" == "--print-command" ]]; then
  print_only=true
  shift
fi

if [[ $# -ne 1 ]]; then
  echo "scheduled_job=invalid" >&2
  exit 2
fi

job="$1"
command_2=()
case "${job}" in
  market-daily)
    command=("${python_bin}" "${worker_root}/ingest_market_data.py" daily --env-file "${env_file}")
    ;;
  smart-four-hourly)
    command=("${python_bin}" "${worker_root}/collect_smart_insights.py" daily --source coinglass-margin-borrow --env-file "${env_file}")
    command_2=("${python_bin}" "${worker_root}/collect_smart_insights.py" daily --source coinglass-liquidation-maxpain --env-file "${env_file}")
    ;;
  smart-daily)
    command=("${python_bin}" "${worker_root}/collect_smart_insights.py" daily --env-file "${env_file}")
    ;;
  smart-weekly)
    command=("${python_bin}" "${worker_root}/collect_smart_insights.py" weekly --env-file "${env_file}")
    ;;
  calendar-current)
    command=("${python_bin}" "${worker_root}/collect_smart_insights.py" calendar-current --env-file "${env_file}")
    ;;
  calendar-next)
    command=("${python_bin}" "${worker_root}/collect_smart_insights.py" calendar-next --env-file "${env_file}")
    ;;
  briefing)
    command=("${python_bin}" "${worker_root}/collect_smart_insights.py" briefing --all-memberships --env-file "${env_file}")
    ;;
  *)
    echo "scheduled_job=invalid" >&2
    exit 2
    ;;
esac

if [[ "${print_only}" == true ]]; then
  printf '%s\n' "${command[*]}"
  if [[ ${#command_2[@]} -gt 0 ]]; then
    printf '%s\n' "${command_2[*]}"
  fi
  exit 0
fi

if [[ ! -x "${python_bin}" || ! -d "${worker_root}" || ! -f "${env_file}" ]]; then
  echo "scheduled_job=runtime_missing" >&2
  exit 1
fi

exec 9>"${lock_file}"
if ! flock -n 9; then
  echo "scheduled_job=skipped_lock"
  exit 0
fi

echo "scheduled_job=started job=${job}"
"${command[@]}"
if [[ ${#command_2[@]} -gt 0 ]]; then
  "${command_2[@]}"
fi
echo "scheduled_job=completed job=${job}"
