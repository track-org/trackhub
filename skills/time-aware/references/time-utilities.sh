#!/usr/bin/env bash
# time-utilities.sh — Sourceable time-aware helper functions
# Usage: source time-utilities.sh; then call functions directly.
#
# Override defaults by setting before sourcing:
#   TIMEZONE=America/New_York source time-utilities.sh

TIMEZONE="${TIMEZONE:-Europe/Dublin}"
QUIET_START="${QUIET_START:-23}"
QUIET_END="${QUIET_END:-8}"
BUSINESS_START="${BUSINESS_START:-9}"
BUSINESS_END="${BUSINESS_END:-17}"

# Current local time components in $TIMEZONE
# Sets: _hour, _minute, _day_of_week (1=Mon..7=Sun), _epoch
time_now() {
  _hour=$(TZ="$TIMEZONE" date '+%H')
  _minute=$(TZ="$TIMEZONE" date '+%M')
  _day_of_week=$(TZ="$TIMEZONE" date '+%u')
  _epoch=$(TZ="$TIMEZONE" date '+%s')
}

# Echo current ISO timestamp in $TIMEZONE
time_iso() {
  TZ="$TIMEZONE" date '+%Y-%m-%dT%H:%M:%S%z'
}

# Check if currently in quiet hours (QUIET_START:00 to QUIET_END:00)
# Returns 0 (true) if quiet, 1 (false) otherwise
is_quiet_hours() {
  time_now
  [ "$_hour" -ge "$QUIET_START" ] || [ "$_hour" -lt "$QUIET_END" ]
}

# Check if currently in business hours (BUSINESS_START:00 to BUSINESS_END:00, weekdays only)
# Returns 0 (true) if business, 1 (false) otherwise
is_business_hours() {
  time_now
  [ "$_day_of_week" -le 5 ] && [ "$_hour" -ge "$BUSINESS_START" ] && [ "$_hour" -lt "$BUSINESS_END" ]
}

# Check if currently in casual hours (not quiet, not business)
# Returns 0 (true) if casual, 1 (false) otherwise
is_casual_hours() {
  ! is_quiet_hours && ! is_business_hours
}

# Get a human-readable time-of-day label: quiet, business, casual
time_label() {
  if is_quiet_hours; then
    echo "quiet"
  elif is_business_hours; then
    echo "business"
  else
    echo "casual"
  fi
}

# Calculate epoch for the next occurrence of a given hour:minute
# Usage: next_occurrence 09 00
# If the time has passed today, returns tomorrow's occurrence
next_occurrence() {
  local target_hour="$1"
  local target_minute="${2:-00}"
  time_now

  local today_str target_epoch
  today_str=$(TZ="$TIMEZONE" date '+%Y-%m-%d')
  target_epoch=$(TZ="$TIMEZONE" date -d "$today_str $target_hour:$target_minute" '+%s' 2>/dev/null)

  if [ -z "$target_epoch" ] || [ "$_epoch" -ge "$target_epoch" ]; then
    # Already passed today (or parse failed) — use tomorrow
    local tomorrow_str
    tomorrow_str=$(TZ="$TIMEZONE" date -d '+1 day' '+%Y-%m-%d')
    target_epoch=$(TZ="$TIMEZONE" date -d "$tomorrow_str $target_hour:$target_minute" '+%s' 2>/dev/null)
  fi

  echo "$target_epoch"
}

# Calculate epoch for next business morning (weekdays only)
# Returns today at BUSINESS_START:00 if before that, otherwise next weekday morning
next_business_morning() {
  time_now
  local target_h="$BUSINESS_START"

  if [ "$_day_of_week" -le 5 ] && [ "$_hour" -lt "$target_h" ]; then
    # Weekday and before business start — today
    local today_str
    today_str=$(TZ="$TIMEZONE" date '+%Y-%m-%d')
    TZ="$TIMEZONE" date -d "$today_str $target_h:00" '+%s'
  else
    # Find next weekday
    local days_ahead=1
    while true; do
      local future_dow future_date
      future_dow=$(TZ="$TIMEZONE" date -d "+${days_ahead} days" '+%u')
      if [ "$future_dow" -le 5 ]; then
        future_date=$(TZ="$TIMEZONE" date -d "+${days_ahead} days" '+%Y-%m-%d')
        TZ="$TIMEZONE" date -d "$future_date $target_h:00" '+%s'
        break
      fi
      days_ahead=$((days_ahead + 1))
    done
  fi
}

# Days until next Monday (0 if today is Monday)
days_until_monday() {
  time_now
  echo $(( (8 - _day_of_week) % 7 ))
}

# Human-friendly relative time description
# Usage: relative_time <epoch>
# Examples: "in 2 hours", "in 3 days", "15 minutes ago"
relative_time() {
  local target="$1"
  time_now
  local diff=$(( target - _epoch ))
  local abs_diff=${diff#-}

  if [ "$diff" -lt 0 ]; then
    # Past
    if [ "$abs_diff" -lt 60 ]; then echo "just now"
    elif [ "$abs_diff" -lt 3600 ]; then echo "$(( abs_diff / 60 )) minutes ago"
    elif [ "$abs_diff" -lt 86400 ]; then echo "$(( abs_diff / 3600 )) hours ago"
    else echo "$(( abs_diff / 86400 )) days ago"
    fi
  else
    # Future
    if [ "$abs_diff" -lt 60 ]; then echo "in less than a minute"
    elif [ "$abs_diff" -lt 3600 ]; then echo "in $(( abs_diff / 60 )) minutes"
    elif [ "$abs_diff" -lt 86400 ]; then echo "in $(( abs_diff / 3600 )) hours"
    else echo "in $(( abs_diff / 86400 )) days"
    fi
  fi
}

# --- Self-test when run directly (not sourced) ---
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "=== time-utilities.sh self-test ==="
  echo "Timezone:     $TIMEZONE"
  echo "ISO now:      $(time_iso)"
  echo "Hour:         $(time_now; echo $_hour)"
  echo "Day of week:  $(time_now; echo $_day_of_week) (1=Mon, 7=Sun)"
  echo "Time label:   $(time_label)"
  echo "Quiet hours:  $(is_quiet_hours && echo yes || echo no)"
  echo "Business hrs: $(is_business_hours && echo yes || echo no)"
  echo "Casual hours: $(is_casual_hours && echo yes || echo no)"
  echo "Next 09:00:   $(TZ="$TIMEZONE" date -d "@$(next_occurrence 9 0)" '+%Y-%m-%d %H:%M %Z')"
  echo "Next biz am:  $(TZ="$TIMEZONE" date -d "@$(next_business_morning)" '+%Y-%m-%d %H:%M %Z')"
  echo "Until Monday: $(days_until_monday) days"
  echo "In 2 hours:   $(relative_time $(( $(TZ="$TIMEZONE" date '+%s') + 7200 )))"
  echo "=== done ==="
fi
