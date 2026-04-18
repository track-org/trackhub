#!/usr/bin/env bash
# git-repo-health.sh — Quick health check for one or more git repositories.
# Usage: git-repo-health.sh [path ...]
#   If no paths given, checks the current directory.
# Exit codes: 0 = all clean, 1 = issues found, 2 = usage error
#
# Zero external dependencies — uses only git and standard POSIX tools.
set -eo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
CYAN=$'\033[0;36m'
NC=$'\033[0m'

JSON=false
QUIET=false
VERBOSE=false

usage() { echo "Usage: git-repo-health.sh [--json] [--quiet] [--verbose] [path ...]"; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)   JSON=true;   shift ;;
    --quiet)  QUIET=true;  shift ;;
    --verbose) VERBOSE=true; shift ;;
    -h|--help) usage ;;
    *) break ;;
  esac
done

# Collect remaining args as repo paths
repos=()
for arg in "$@"; do
  repos+=("$arg")
done
[[ ${#repos[@]} -eq 0 ]] && repos=(".")
has_issues=false

check_repo() {
  local repo="$1"
  local name
  name=$(basename "$(cd "$repo" && pwd)")

  local branch=""
  local -a issues=()
  local -a warnings=()
  local -a info=()

  # Must be a git repo
  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    issues+=("not a git repository")
  else
    # Current branch
    branch=$(git -C "$repo" symbolic-ref --short HEAD 2>/dev/null || git -C "$repo" rev-parse --short HEAD 2>/dev/null)

    # Ahead/behind remote (only if tracking)
    if tracking=$(git -C "$repo" config "branch.${branch}.remote" 2>/dev/null); then
      local ab behind ahead
      ab=$(git -C "$repo" rev-list --left-right --count "@{upstream}...HEAD" 2>/dev/null || echo "0	0")
      behind=$(echo "$ab" | cut -f1)
      ahead=$(echo "$ab" | cut -f2)
      [[ "$behind" -gt 0 ]] && issues+=("${behind} commit(s) behind remote")
      [[ "$ahead" -gt 0 ]] && warnings+=("${ahead} unpushed commit(s)")
    else
      warnings+=("no upstream tracking branch set")
    fi

    # Working tree status
    local staged unstaged untracked
    staged=$(git -C "$repo" diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
    unstaged=$(git -C "$repo" diff --numstat 2>/dev/null | wc -l | tr -d ' ')
    untracked=$(git -C "$repo" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
    [[ "$staged" -gt 0 ]] && warnings+=("${staged} staged file(s)")
    [[ "$unstaged" -gt 0 ]] && warnings+=("${unstaged} unstaged change(s)")
    [[ "$untracked" -gt 0 ]] && info+=("${untracked} untracked file(s)")

    # Stashes
    local stashes
    stashes=$(git -C "$repo" stash list 2>/dev/null | wc -l | tr -d ' ')
    [[ "$stashes" -gt 0 ]] && info+=("${stashes} stash(es)")

    # Last commit age (verbose mode)
    if $VERBOSE; then
      local last_commit
      last_commit=$(git -C "$repo" log -1 --format="%h %s (%cr)" 2>/dev/null)
      info+=("last commit: ${last_commit}")
    fi

    # Detached HEAD
    if ! git -C "$repo" symbolic-ref HEAD >/dev/null 2>&1; then
      issues+=("detached HEAD")
    fi
  fi

  # Tally
  local status="clean"
  if [[ ${#issues[@]} -gt 0 ]]; then
    status="issues"
    has_issues=true
  elif [[ ${#warnings[@]} -gt 0 ]]; then
    status="warnings"
  fi

  # Output
  if $JSON; then
    local entry
    local i_str w_str n_str
    if [[ ${#issues[@]} -eq 0 ]]; then
      i_str="[]"
    else
      i_str=$(printf '%s\n' "${issues[@]}" | jq -R . | jq -sc)
    fi
    if [[ ${#warnings[@]} -eq 0 ]]; then
      w_str="[]"
    else
      w_str=$(printf '%s\n' "${warnings[@]}" | jq -R . | jq -sc)
    fi
    if [[ ${#info[@]} -eq 0 ]]; then
      n_str="[]"
    else
      n_str=$(printf '%s\n' "${info[@]}" | jq -R . | jq -sc)
    fi
    entry=$(printf '{ "repo":"%s","branch":"%s","status":"%s","issues":%s,"warnings":%s,"info":%s }' \
      "$name" "${branch:-N/A}" "$status" "$i_str" "$w_str" "$n_str")
    echo "$entry"
  else
    local icon=""
    case "$status" in
      clean)   icon="OK";    color="$GREEN" ;;
      warnings) icon="WARN"; color="$YELLOW" ;;
      issues)  icon="FAIL";  color="$RED" ;;
    esac

    if $QUIET; then
      if [[ "$status" != "clean" ]]; then
        printf "[%s] %s\n" "$icon" "$name"
      fi
    else
      printf "[%s] %b%s%b (%s)\n" "$icon" "$color" "$name" "$NC" "${branch:-N/A}"
      local item
      for item in "${issues[@]+"${issues[@]}"}"; do
        printf "  %b  x %s%b\n" "$RED" "$item" "$NC"
      done
      for item in "${warnings[@]+"${warnings[@]}"}"; do
        printf "  %b  ! %s%b\n" "$YELLOW" "$item" "$NC"
      done
      for item in "${info[@]+"${info[@]}"}"; do
        printf "    . %s\n" "$item"
      done
    fi
  fi
}

# Main
if $JSON; then
  echo "["
  first=true
  for repo in "${repos[@]}"; do
    $first || echo ","
    first=false
    check_repo "$repo"
  done
  echo "]"
else
  for repo in "${repos[@]}"; do
    check_repo "$repo"
  done
fi

$has_issues && exit 1
exit 0
