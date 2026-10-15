#!/usr/bin/env bash
# Read-only deployment checks. Sourcing this file only defines functions.

deployment_error() {
  local status=${1:-1} line=${2:-unknown}
  if (( status == 0 )); then return 0; fi
  if (( status == 137 )); then
    printf 'Deployment aborted at line %s: a process was killed (SIGKILL, exit 137). Investigate the server; do not retry or bypass the failed utility.\n' "$line" >&2
  else
    printf 'Deployment aborted at line %s (exit %s).\n' "$line" "$status" >&2
  fi
  return "$status"
}

brainycp_guard() {
  local panel=${1:-} physical status line value count=0
  local key_pattern='^[[:space:]]*back_server([^A-Za-z0-9_]|$)'
  local assignment_pattern='^[[:space:]]*back_server[[:space:]]*=[[:space:]]*(.*)$'
  local spaced_pattern='^[[:space:]]*back_server[[:space:]]+([^=].*)$'
  local value_pattern="^([A-Za-z0-9_./:+-]+|\"[A-Za-z0-9_./:+-]+\"|'[A-Za-z0-9_./:+-]+')[[:space:]]*([#;].*)?$"
  if [[ $# -ne 1 || $panel != /* || $panel =~ [[:cntrl:]] || ! -f $panel || -L $panel ]]; then
    printf 'BrainyCP guard: expected a physical regular panel configuration file.\n' >&2
    return 1
  fi
  if physical=$(readlink -e -- "$panel" 2>/dev/null); then :; else
    status=$?
    deployment_error "$status" "$LINENO"
    return "$status"
  fi
  if [[ $physical != "$panel" ]]; then
    printf 'BrainyCP guard: panel configuration path must not contain symlinks.\n' >&2
    return 1
  fi
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*[#\;] ]] && continue
    [[ $line =~ $key_pattern ]] || continue
    count=$((count + 1))
    if (( count > 1 )); then
      printf 'BrainyCP guard: duplicate back_server settings; deployment refused.\n' >&2
      return 1
    fi
    if [[ $line =~ $assignment_pattern ]]; then
      value=${BASH_REMATCH[1]}
    elif [[ $line =~ $spaced_pattern ]]; then
      value=${BASH_REMATCH[1]}
    else
      printf 'BrainyCP guard: ambiguous back_server setting; deployment refused.\n' >&2
      return 1
    fi
    if [[ ! $value =~ $value_pattern ]]; then
      printf 'BrainyCP guard: back_server must have one nonempty supported value; deployment refused.\n' >&2
      return 1
    fi
  done < "$panel"
  if (( count != 1 )); then
    printf 'BrainyCP guard: active back_server setting is missing; deployment refused.\n' >&2
    return 1
  fi
}

validate_php_checks() {
  local checks=${1:-} url host label
  local -a urls labels
  local -A seen=()
  local url_pattern='^https://([A-Za-z0-9.-]+)(/[A-Za-z0-9/_.~-]*)?$'
  local label_pattern='^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
  if [[ $# -ne 1 || -z $checks || $checks == ,* || $checks == *, || $checks == *,,* || $checks =~ [[:space:][:cntrl:]] ]]; then
    printf 'PHP checks: provide 1 to 10 distinct HTTPS endpoint URLs separated by commas, without whitespace.\n' >&2
    return 2
  fi
  IFS=, read -r -a urls <<< "$checks"
  if (( ${#urls[@]} < 1 || ${#urls[@]} > 10 )); then
    printf 'PHP checks: provide between 1 and 10 endpoint URLs.\n' >&2
    return 2
  fi
  for url in "${urls[@]}"; do
    if (( ${#url} > 2048 )) || [[ ! $url =~ $url_pattern ]]; then
      printf 'PHP checks: invalid HTTPS endpoint URL; ports, credentials, queries and fragments are not supported.\n' >&2
      return 2
    fi
    host=${BASH_REMATCH[1]}
    if (( ${#host} > 253 )) || [[ $host != *.* || $host == .* || $host == *. || $host == *..* ]]; then
      printf 'PHP checks: endpoint host must be a complete valid hostname.\n' >&2
      return 2
    fi
    IFS=. read -r -a labels <<< "$host"
    for label in "${labels[@]}"; do
      if [[ ! $label =~ $label_pattern ]]; then
        printf 'PHP checks: endpoint host contains an invalid DNS label.\n' >&2
        return 2
      fi
    done
    if [[ ${seen[$url]+present} ]]; then
      printf 'PHP checks: duplicate endpoint URL.\n' >&2
      return 2
    fi
    seen[$url]=1
  done
}

php_snapshot() {
  local checks=${1:-} baseline=${2:-} line url status exit_status output=''
  local -a urls
  local -A expected=()
  if [[ $# -lt 1 || $# -gt 2 ]]; then
    printf 'PHP checks: expected endpoint URLs and an optional baseline snapshot.\n' >&2
    return 2
  fi
  validate_php_checks "$checks" || return "$?"
  IFS=, read -r -a urls <<< "$checks"
  if [[ $# -eq 2 ]]; then
    while IFS= read -r line || [[ -n $line ]]; do
      if [[ ! $line =~ ^([^[:space:]]+)\ (2[0-9]{2})$ ]]; then
        printf 'PHP checks: malformed baseline snapshot.\n' >&2
        return 2
      fi
      url=${BASH_REMATCH[1]} status=${BASH_REMATCH[2]}
      if [[ ${expected[$url]+present} ]]; then
        printf 'PHP checks: duplicate baseline endpoint.\n' >&2
        return 2
      fi
      expected[$url]=$status
    done <<< "$baseline"
    if (( ${#expected[@]} != ${#urls[@]} )); then
      printf 'PHP checks: baseline endpoints do not match the requested checks.\n' >&2
      return 2
    fi
    for url in "${urls[@]}"; do
      if [[ ! ${expected[$url]+present} ]]; then
        printf 'PHP checks: baseline endpoints do not match the requested checks.\n' >&2
        return 2
      fi
    done
  fi
  for url in "${urls[@]}"; do
    if status=$(curl --disable --noproxy '*' --proto '=https' --max-time 15 --connect-timeout 5 --silent --show-error --output /dev/null --write-out '%{http_code}' --url "$url"); then :; else
      exit_status=$?
      printf 'PHP health check failed for %s.\n' "$url" >&2
      deployment_error "$exit_status" "$LINENO"
      return "$exit_status"
    fi
    if [[ ! $status =~ ^[0-9]{3}$ ]]; then
      printf 'PHP health check failed for %s: curl returned invalid status metadata.\n' "$url" >&2
      return 1
    fi
    if [[ ! $status =~ ^2[0-9]{2}$ ]]; then
      printf 'PHP health check failed for %s: expected a direct 2xx response (HTTP %s).\n' "$url" "$status" >&2
      return 1
    fi
    if [[ $# -eq 2 && $status != "${expected[$url]}" ]]; then
      printf 'PHP health check changed for %s: HTTP %s became %s.\n' "$url" "${expected[$url]}" "$status" >&2
      return 1
    fi
    output+="$url $status"$'\n'
  done
  printf '%s' "$output"
}

if [[ ${BASH_SOURCE[0]:-} == "$0" || ( -z ${BASH_SOURCE[0]:-} && ${0##*/} == bash ) ]]; then
  if [[ $# -ne 2 ]]; then
    printf 'Usage: bash brainycp-guards.sh PANEL_MAIN PHP_ENDPOINTS\n' >&2
    exit 2
  fi
  validate_php_checks "$2" || exit "$?"
  brainycp_guard "$1" || exit "$?"
  php_snapshot "$2"
fi
