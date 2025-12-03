#!/usr/bin/env bash
if [ "$EUID" -ne 0 ]
  then echo "ERROR: Please run as root"
  exit 1
fi

SCRIPT_DIR=$( cd -- "$( dirname -- "$(realpath -- "${BASH_SOURCE[0]}")" )" &> /dev/null && pwd )

# Source logging library first
# shellcheck source=configuration/scripts/ratos-logging.sh
source "$SCRIPT_DIR"/ratos-logging.sh

# Set up error trapping and logging
setup_error_trap "ratos-update"
START_TIME=$(get_timestamp)

# Log script start
log_script_start "ratos-update.sh" "2.1.0"

# shellcheck source=configuration/scripts/ratos-common.sh
source "$SCRIPT_DIR"/ratos-common.sh
# shellcheck source=configuration/scripts/moonraker-ensure-policykit-rules.sh
source "$SCRIPT_DIR"/moonraker-ensure-policykit-rules.sh

ensure_system_packages()
{
	log_info "Ensuring system packages from PKGLIST are installed" "ensure_system_packages"
	report_status "Ensuring required system packages are installed"

	if [ -z "${PKGLIST:-}" ]; then
		log_error "PKGLIST is not defined; expected from ratos-common.sh" "ensure_system_packages" "PKGLIST_MISSING"
		echo "PKGLIST is not defined; expected from ratos-common.sh"
		return 1
	fi

	# Build list of missing packages
	local -a pkgs missing
	local pkg
	# shellcheck disable=SC2206
	pkgs=( $PKGLIST )
	missing=()
	for pkg in "${pkgs[@]}"; do
		if ! dpkg -s "$pkg" >/dev/null 2>&1; then
			missing+=("$pkg")
		fi
	done

	if [ ${#missing[@]} -eq 0 ]; then
		log_info "All required system packages are already installed" "ensure_system_packages"
		echo "All required system packages are already installed"
		return 0
	fi

	log_info "Missing packages: ${missing[*]}" "ensure_system_packages"
	echo "Installing missing packages: ${missing[*]}"

	if ! execute_with_logging "ensure_system_packages" "APT_UPDATE_FAILED" apt-get update; then
		log_error "apt-get update failed" "ensure_system_packages" "APT_UPDATE_FAILED"
		return 1
	fi

	# shellcheck disable=SC2068
	if ! execute_with_logging "ensure_system_packages" "APT_INSTALL_FAILED" apt-get install -y ${missing[@]}; then
		log_error "Failed to install one or more system packages" "ensure_system_packages" "APT_INSTALL_FAILED"
		return 1
	fi

	log_info "System packages installed successfully" "ensure_system_packages"
	echo "System packages installed successfully"
}

ensure_pip_requirements()
{
	log_info "Ensuring Python pip requirements are installed in KLIPPER_ENV" "ensure_pip_requirements"
	report_status "Installing Python requirements into Klipper env"

	local req_file py_bin pip_bin
	req_file="${SCRIPT_DIR}/../klippy/requirements.txt"
	py_bin="${KLIPPER_ENV}/bin/python"
	pip_bin="${KLIPPER_ENV}/bin/pip"

	if [ -z "${KLIPPER_ENV:-}" ] || [ ! -d "$KLIPPER_ENV" ]; then
		log_error "Klipper environment not found or KLIPPER_ENV unset: $KLIPPER_ENV" "ensure_pip_requirements" "PYTHON_ENV_MISSING"
		echo "Klipper environment not found or KLIPPER_ENV unset: $KLIPPER_ENV"
		return 1
	fi

	if [ ! -x "$pip_bin" ]; then
		if [ -x "$py_bin" ]; then
			pip_bin="$py_bin -m pip"
		else
			log_error "pip not found in Klipper environment: $pip_bin" "ensure_pip_requirements" "PIP_NOT_FOUND"
			echo "pip not found in Klipper environment: $pip_bin"
			return 1
		fi
	fi

	if [ ! -f "$req_file" ]; then
		log_error "Requirements file not found: $req_file" "ensure_pip_requirements" "PIP_REQUIREMENTS_FILE_MISSING"
		echo "Requirements file not found: $req_file"
		return 1
	fi

	# Prefer installing as the RatOS user to avoid root-owned files in the venv
	if ! execute_with_logging "ensure_pip_requirements" "PIP_INSTALL_FAILED" sudo -u "${RATOS_USERNAME}" "$py_bin" -m pip install -r "$req_file"; then
		log_error "Failed to install Python requirements into Klipper environment" "ensure_pip_requirements" "PIP_INSTALL_FAILED"
		echo "Failed to install Python requirements into Klipper environment"
		return 1
	fi

	log_info "Python requirements installed successfully" "ensure_pip_requirements"
	echo "Python requirements installed successfully"
}

update_symlinks()
{
  log_info "Updating RatOS device symlinks..." "update_symlinks"
  report_status "Updating RatOS device symlinks..."

  # Get list of board rule files
  board_rules=("${RATOS_PRINTER_DATA_DIR}"/config/RatOS/boards/*/*.rules)

  local updated_count=0
  local skipped_count=0

  # Check each board rule file
  for source in "${board_rules[@]}"; do
    if [ ! -f "$source" ]; then
      log_debug "Skipping non-existent rule file: $source" "update_symlinks"
      continue
    fi

    filename=$(basename "$source")
    target="/etc/udev/rules.d/98-${filename}"

    # Check if symlink exists and points to correct source
    if [ ! -L "$target" ] || [ ! "$(readlink "$target")" = "$source" ]; then
      if execute_with_logging "update_symlinks" "SYMLINK_REMOVE_FAILED" rm -f "$target"; then
        if execute_with_logging "update_symlinks" "SYMLINK_CREATE_FAILED" ln -s "$source" "$target"; then
          log_info "Updated symlink for ${filename}" "update_symlinks"
          echo "Updated symlink for ${filename}"
          ((updated_count++))
        else
          log_error "Failed to create symlink for ${filename}" "update_symlinks" "SYMLINK_CREATE_FAILED"
          return 1
        fi
      else
        log_error "Failed to remove old symlink for ${filename}" "update_symlinks" "SYMLINK_REMOVE_FAILED"
        return 1
      fi
    else
      log_debug "Symlink for ${filename} already correct" "update_symlinks"
      echo "Symlink for ${filename} already correct"
      ((skipped_count++))
    fi
  done

  log_info "Symlink update complete: $updated_count updated, $skipped_count skipped" "update_symlinks"
  echo "RatOS device symlinks are up to date!"
}

ensure_node_18()
{
	log_info "Ensuring Node 18 is installed" "ensure_node_18"
	report_status "Ensuring Node 18 is installed"

	if node -v | grep "^v18" > /dev/null; then
		log_info "Node 18 already installed" "ensure_node_18"
		echo "Node 18 already installed"
	else
		log_info "Installing Node 18" "ensure_node_18"
		echo "Installing Node 18"

		if execute_with_logging "ensure_node_18" "NODE_REPO_UPDATE_FAILED" sed -i 's/node_16\.x/node_18\.x/g' /etc/apt/sources.list.d/nodesource.list; then
			if execute_with_logging "ensure_node_18" "APT_UPDATE_FAILED" apt-get update; then
				if execute_with_logging "ensure_node_18" "NODE_INSTALL_FAILED" apt-get install -y nodejs; then
					log_info "Node 18 installed successfully" "ensure_node_18"
					echo "Node 18 installed!"
				else
					log_error "Failed to install Node 18" "ensure_node_18" "NODE_INSTALL_FAILED"
					return 1
				fi
			else
				log_error "Failed to update package lists" "ensure_node_18" "APT_UPDATE_FAILED"
				return 1
			fi
		else
			log_error "Failed to update Node.js repository configuration" "ensure_node_18" "NODE_REPO_UPDATE_FAILED"
			return 1
		fi
	fi
}

fix_klippy_env_ownership()
{
	log_info "Ensuring klipper environment ownership" "fix_klippy_env_ownership"
	report_status "Ensuring klipper environment ownership"

	if [ -n "$(find "${KLIPPER_ENV}" \! -user "${RATOS_USERNAME}" -o \! -group "${RATOS_USERGROUP}" -quit)" ]; then
		if execute_with_logging "fix_klippy_env_ownership" "OWNERSHIP_CHANGE_FAILED" chown -R "${RATOS_USERNAME}:${RATOS_USERGROUP}" "${KLIPPER_ENV}"; then
			log_info "Klipper environment ownership has been set to ${RATOS_USERNAME}:${RATOS_USERGROUP}" "fix_klippy_env_ownership"
			echo "Klipper environment ownership has been set to ${RATOS_USERNAME}:${RATOS_USERGROUP}."
		else
			log_error "Failed to change klipper environment ownership" "fix_klippy_env_ownership" "OWNERSHIP_CHANGE_FAILED"
			return 1
		fi
	else
		log_info "Klipper environment ownership already set correctly" "fix_klippy_env_ownership"
		echo "Klipper environment ownership already set correctly."
	fi
}

symlink_extensions()
{
	log_info "Symlinking klippy extensions" "symlink_extensions"
	report_status "Symlinking klippy extensions"

	if execute_with_logging "symlink_extensions" "EXTENSION_SYMLINK_FAILED" ratos extensions symlink; then
		log_info "Klippy extensions symlinked successfully" "symlink_extensions"
		echo "Klippy extensions symlinked!"
	else
		log_error "Failed to symlink klippy extensions. Is the RatOS configurator running?" "symlink_extensions" "EXTENSION_SYMLINK_FAILED"
		echo "Failed to symlink klippy extensions. Is the RatOS configurator running?"
		return 1
	fi
}


# ensure_klipper_fork_migration() - Ensures Klipper repository is migrated to RatOS fork
#
# This function delegates all repository state validation and migration logic to the
# dedicated klipper-fork-migration.sh script, which provides comprehensive handling of:
# - Official Klipper repositories (migration needed)
# - RatOS fork repositories at correct state (migration not needed)
# - RatOS fork repositories at incorrect state (migration needed)
# - Unsupported repository sources (fatal error)
# - All edge cases including detached HEAD, uncommitted changes, etc.
#
# RETURN CODES:
#   0 - Success: Migration completed successfully or was not needed
#   1+ - Error: Migration failed (specific error codes from migration script)
#
ensure_klipper_fork_migration()
{
	log_info "Ensuring Klipper repository is properly configured..." "ensure_klipper_migration"

	# Delegate all repository validation and migration logic to the dedicated script
	# The migration script handles all scenarios comprehensively:
	# - Repository state validation with 4 distinct scenarios
	# - Graceful skipping when migration is not needed
	# - Comprehensive error handling and edge case management
	# - Consistent logging and error reporting
	"$SCRIPT_DIR"/klipper-fork-migration.sh
	local code=$?
	if [[ $code -ne 0 ]]; then
		log_error "Klipper fork migration failed (exit code $code)!" "ensure_klipper_migration" "KLIPPER_MIGRATION_FAILED"
		return $code
	fi

	log_info "Klipper repository configuration verified successfully!" "ensure_klipper_migration"
	return 0
}

# Main execution with error handling
main() {
	local exit_code=0

	log_info "Starting RatOS update process" "main"

	# Run update functions with error handling
	# Use set +e to prevent immediate exit on function failure
	set +e

	ensure_klipper_fork_migration || exit_code=1
	ensure_system_packages || exit_code=1
	update_symlinks || exit_code=1
	ensure_sudo_command_whitelisting || exit_code=1
	ensure_service_permission || exit_code=1
	ensure_node_18 || exit_code=1
	fix_klippy_env_ownership || exit_code=1
	ensure_pip_requirements || exit_code=1
	patch_klipperscreen_service_restarts || exit_code=1
	install_beacon || exit_code=1
	install_hooks || exit_code=1
	remove_old_postprocessor || exit_code=1
	verify_registered_extensions || exit_code=1
	symlink_extensions || exit_code=1
	update_beacon_fw || exit_code=1

	# Re-enable exit on error for cleanup
	set -e

	# Create log summary and complete
	create_log_summary "ratos-update.sh" "$START_TIME"
	log_script_complete "ratos-update.sh" "$exit_code"

	if [[ $exit_code -ne 0 ]]; then
		log_error "RatOS update completed with errors. Check the log file: $RATOS_LOG_FILE" "main" "UPDATE_FAILED"
		echo "RatOS update completed with errors. Check the log file: $RATOS_LOG_FILE"
	else
		log_info "RatOS update completed successfully" "main"
		echo "RatOS update completed successfully"
	fi

	exit "$exit_code"
}

# Run main function
main
