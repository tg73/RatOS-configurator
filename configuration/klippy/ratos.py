# RatOS general purpose module
#
# Copyright (C) 2024 Helge Keck <HelgeKeck@hotmail.com.com>
# Copyright (C) 2024 Mikkel Schmidt <mikkel.schmidt@gmail.com>
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import os, logging, glob, traceback, inspect, re, time
import json, subprocess, pathlib, random, math
from collections import namedtuple
import numpy as np

BeaconProbingRegions = namedtuple('BeaconProbingRegions', 
			['x_offset', 'y_offset', 'proximity_min', 'proximity_max', 'contact_min', 'contact_max'])
"""
 A named tuple containing:
	- x_offset: X offset of the Beacon probe
	- y_offset: Y offset of the Beacon probe
	- proximity_min: Tuple of (min_x, min_y) for proximity probing
	- proximity_max: Tuple of (max_x, max_y) for proximity probing
	- contact_min: Tuple of (min_x, min_y) for contact probing
	- contact_max: Tuple of (max_x, max_y) for contact probing
"""

#####
# RatOS
#####

class RatOS:

	#####
	# Initialize
	#####
	def __init__(self, config):
		self.config = config
		self.printer = config.get_printer()
		self.name = config.get_name()
		self.bypass_post_processing = False
		self.enable_gcode_transform = False
		self.allow_unsupported_slicer_versions = False
		self.allow_unknown_gcode_generator = False
		self.gcode = self.printer.lookup_object('gcode')
		self.reactor = self.printer.get_reactor()
		self.overridden_commands = {
			'TEST_RESONANCES': None,
			'SHAPER_CALIBRATE': None,
		}

		# Fields initialized in _connect
		self.v_sd = None
		self.sdcard_dirname = None
		self.dual_carriage = None
		self.rmmu_hub = None
		self.bed_mesh = None
		self.gm_ratos = None
		self.toolhead = None
		self.beacon = None
		self.display_status = None

		# Status fields
		self.last_processed_file_result = None
		self.last_check_bed_mesh_profile_exists_result = None
		self.last_move_to_safe_z_home_position = None

		self.old_is_graph_files = []
		self.load_settings()
		self.register_commands()
		self.register_handler()
		self.load_settings()
		self.post_process_success = False

	#####
	# Handler
	#####
	def register_handler(self):
		self.printer.register_event_handler("klippy:connect", self._connect)

	def _connect(self):
		self.v_sd = self.printer.lookup_object('virtual_sdcard', None)
		self.sdcard_dirname = self.v_sd.sdcard_dirname
		self.gm_ratos = self.printer.lookup_object('gcode_macro RatOS')
		self.toolhead = self.printer.lookup_object("toolhead")
		self.display_status = self.printer.lookup_object("display_status")

		if self.config.has_section("dual_carriage"):
			self.dual_carriage = self.printer.lookup_object("dual_carriage", None)
		if self.config.has_section("rmmu_hub"):
			self.rmmu_hub = self.printer.lookup_object("rmmu_hub", None)
		if self.config.has_section("bed_mesh"):
			self.bed_mesh = self.printer.lookup_object('bed_mesh')
		if self.config.has_section("beacon"):
			self.beacon = self.printer.lookup_object('beacon')

		# Register overrides.
		self.register_command_overrides()

	def _check_cpu_governors(self):
		desired_governor = 'performance'
		try:
			governors = self.get_cpu_governors()
		except Exception as e:
			self.console_echo(
				'CPU governor check', 'warning',
				f'Failed to check current CPU governors. RatOS recommends setting all CPU governors to "{desired_governor}" for optimal printing performance._N_' +
				'Reason: ' + str(e))
			return
		non_performance_governors = governors - {desired_governor}
		if non_performance_governors:
			self.console_echo(
				'CPU governor check', 'warning',
				f'RatOS recommends setting all CPU governors to "{desired_governor}" for optimal printing performance._N_' +
				'Current CPU governor(s) detected: ' + ', '.join(governors))		
	#####
	# Settings
	#####
	def load_settings(self):
		self.enable_gcode_transform = self.config.getboolean('enable_gcode_transform', False)
		self.bypass_post_processing = self.config.getboolean('bypass_post_processing', False)
		self.allow_unknown_gcode_generator = self.config.getboolean('allow_unknown_gcode_generator', False)
		self.allow_unsupported_slicer_versions = self.config.getboolean('allow_unsupported_slicer_versions', False)

	#####
	# Gcode commands
	#####
	def register_commands(self):
		self.gcode.register_command('HELLO_RATOS', self.cmd_HELLO_RATOS, desc=self.desc_HELLO_RATOS)
		self.gcode.register_command('CACHE_IS_GRAPH_FILES', self.cmd_CACHE_IS_GRAPH_FILES, desc=self.desc_CACHE_IS_GRAPH_FILES)
		self.gcode.register_command('SHOW_IS_GRAPH_FILES', self.cmd_SHOW_IS_GRAPH_FILES, desc=self.desc_SHOW_IS_GRAPH_FILES)
		self.gcode.register_command('CONSOLE_ECHO', self.cmd_CONSOLE_ECHO, desc=self.desc_CONSOLE_ECHO)
		self.gcode.register_command('RATOS_LOG', self.cmd_RATOS_LOG, desc=self.desc_RATOS_LOG)
		self.gcode.register_command('PROCESS_GCODE_FILE', self.cmd_PROCESS_GCODE_FILE, desc=self.desc_PROCESS_GCODE_FILE)
		self.gcode.register_command('ALLOW_UNKNOWN_GCODE_GENERATOR', self.cmd_ALLOW_UNKNOWN_GCODE_GENERATOR, desc=self.desc_ALLOW_UNKNOWN_GCODE_GENERATOR)
		self.gcode.register_command('BYPASS_GCODE_PROCESSING', self.cmd_BYPASS_GCODE_PROCESSING, desc=self.desc_BYPASS_GCODE_PROCESSING)
		self.gcode.register_command('_SYNC_GCODE_POSITION', self.cmd_SYNC_GCODE_POSITION, desc=self.desc_SYNC_GCODE_POSITION)
		self.gcode.register_command('_CHECK_BED_MESH_PROFILE_EXISTS', self.cmd_CHECK_BED_MESH_PROFILE_EXISTS, desc=self.desc_CHECK_BED_MESH_PROFILE_EXISTS)
		self.gcode.register_command('_RAISE_ERROR', self.cmd_RAISE_ERROR, desc=self.desc_RAISE_ERROR)
		self.gcode.register_command('_TRY', self.cmd_TRY, desc=self.desc_TRY)
		self.gcode.register_command('_DEBUG_ECHO_STACK_TRACE', self.cmd_DEBUG_ECHO_STACK_TRACE, desc=self.desc_DEBUG_ECHO_STACK_TRACE)
		self.gcode.register_command('_MOVE_TO_SAFE_Z_HOME', self.cmd_MOVE_TO_SAFE_Z_HOME, desc=self.desc_MOVE_TO_SAFE_Z_HOME)
		self.gcode.register_command('CONFIGURE_DC_ENDSTOP', self.cmd_CONFIGURE_DC_ENDSTOP, desc=self.desc_CONFIGURE_DC_ENDSTOP)
		self.gcode.register_command('RESET_DC_ENDSTOP_CONFIGURATION', self.cmd_RESET_DC_ENDSTOP_CONFIGURATION, desc=self.desc_RESET_DC_ENDSTOP_CONFIGURATION)
		self.gcode.register_command('INCREASE_Y_MAX', self.cmd_INCREASE_Y_MAX, desc=self.desc_INCREASE_Y_MAX)
		self.gcode.register_command('RESET_Y_MAX_ADJUSTMENT', self.cmd_RESET_Y_MAX_ADJUSTMENT, desc=self.desc_RESET_Y_MAX_ADJUSTMENT)
		self.gcode.register_command('_BEACON_CHECK_DIRECTIONAL_REPEATABILITY', self.cmd_BEACON_CHECK_DIRECTIONAL_REPEATABILITY, desc=self.desc_BEACON_CHECK_DIRECTIONAL_REPEATABILITY)

	def register_command_overrides(self):
		self.register_override('TEST_RESONANCES', self.override_TEST_RESONANCES, desc=self.desc_TEST_RESONANCES)
		self.register_override('SHAPER_CALIBRATE', self.override_SHAPER_CALIBRATE, desc=self.desc_SHAPER_CALIBRATE)

	def register_override(self, command, func, desc):
		if self.overridden_commands[command] is not None:
			if self.overridden_commands[command] != func:
				raise self.printer.config_error("Command '%s' is already overridden with a different function" % (command,))
			return

		prev_cmd = self.gcode.register_command(command, None)
		if prev_cmd is None:
			if (command == 'TEST_RESONANCES' or command == 'SHAPER_CALIBRATE') and not self.config.has_section('resonance_tester'):
				# No [resonance_tester] section found, don't throw an error, skip overriding.
				logging.info("No [resonance_tester] section found, skipping override of command '%s'" % (command,))
				return
			else:
				raise self.printer.config_error("Existing command '%s' not found in RatOS override" % (command,))
		if command not in self.overridden_commands:
			raise self.printer.config_error("Command '%s' not found in RatOS override list" % (command,))

		self.overridden_commands[command] = prev_cmd;
		self.gcode.register_command(command, func, desc=(desc))

	def get_prev_cmd(self, command):
		if command not in self.overridden_commands or self.overridden_commands[command] is None:
			raise self.printer.config_error("Previous function for command '%s' not found in RatOS override list" % (command,))
		return self.overridden_commands[command]

	desc_TEST_RESONANCES = ("Runs the resonance test for a specifed axis, positioning errors caused by sweeping are corrected by a RatOS override of this command.")
	def override_TEST_RESONANCES(self, gcmd):
		prev_cmd = self.get_prev_cmd('TEST_RESONANCES')
		prev_cmd(gcmd)
		self.cmd_SYNC_GCODE_POSITION(gcmd)

	desc_SHAPER_CALIBRATE = ("Runs the shaper calibration for a specifed axis, positioning errors caused by sweeping are corrected by a RatOS override of this command.")
	def override_SHAPER_CALIBRATE(self, gcmd):
		prev_cmd = self.get_prev_cmd('SHAPER_CALIBRATE')
		prev_cmd(gcmd)
		self.cmd_SYNC_GCODE_POSITION(gcmd)

	desc_SYNC_GCODE_POSITION = ("Syncs the toolhead position to the printer position, used internally to correct positioning errors caused by sweeping in resonance tests.")
	def cmd_SYNC_GCODE_POSITION(self, gcmd):
		toolhead = self.printer.lookup_object('toolhead')
		toolhead.manual_move((None, None, None), 100)

	desc_ALLOW_UNKNOWN_GCODE_GENERATOR = "Temporarily allow gcode from generators that cannot be identified by the postprocessor"
	def cmd_ALLOW_UNKNOWN_GCODE_GENERATOR(self, gcmd):
		self.allow_unknown_gcode_generator = True

	desc_BYPASS_GCODE_PROCESSING = "Disables postprocessor for the next print."
	def cmd_BYPASS_GCODE_PROCESSING(self, gcmd):
		self.bypass_post_processing = True
		self.console_echo('Post-processing bypassed on next print', 'info', "_N_".join([
			'Post-processing will be bypassed on the next print.',
			'You can bypass post-processing permanently by adding the following to printer.cfg._N_',
			'[ratos]',
			'bypass_post_processing: True_N_'
		]))

	desc_HELLO_RATOS = "RatOS mainsail welcome message"
	def cmd_HELLO_RATOS(self, gcmd):
		url = "https://os.ratrig.com/"
		img = "../server/files/config/RatOS/Logo-white.png"
		ratos_version = self.get_ratos_version().split('-')
		_title = '<p style="font-weight: bold; margin:0; color:white">Welcome to RatOS ' +  ratos_version[0] + '</p>'
		_sub_title = '<div style="margin:0; padding:0; color: rgba(255, 255, 255, 0.7)">' + '-'.join(ratos_version) + '</div>'
		_info = '<div style="margin:0; padding:0; color: rgba(255, 255, 255, 0.7)">\nClick image to open documentation.</div>'
		_img = '\n<a href="' + url + '" target="_blank" ><img style="margin-top:6px;" src="' + img + '" width="258px"></a>'
		self.gcode.respond_raw('<div>' + _title + _sub_title + _img + _info + '</div>')
		self._check_cpu_governors()

	desc_CONSOLE_ECHO = "Multiline console output"
	def cmd_CONSOLE_ECHO(self, gcmd):
		title = gcmd.get('TITLE', '')
		msg = gcmd.get('MSG', None)
		type = gcmd.get('TYPE', '')

		self.console_echo(title, type, msg)

	desc_SHOW_IS_GRAPH_FILES = "Shows the last generated IS graph in the console"
	def cmd_SHOW_IS_GRAPH_FILES(self, gcmd):
		try:
			counter = 0
			new_is_graph_files = self.get_is_graph_files()
			for file_path in new_is_graph_files:
				if file_path not in self.old_is_graph_files:
					title = gcmd.get('TITLE', '')
					file_name = file_path.replace("/home/pi/printer_data/config/input_shaper/", "")
					url = file_path.replace("/home/pi/printer_data", "../server/files")
					title = title + ': ' if title != '' else ''
					_title = '<p style="font-weight: bold; margin:0; color:white">' + title + file_name + '</p>'
					_link = 'Click image to download or right click for options.'
					_img = '<a href="' + url + '" target="_blank" ><img src="' + url + '" width="100%"></a>'
					self.gcode.respond_raw(_title + _link + _img)
					counter += 1
					if counter == 10:
						break
			self.old_is_graph_files = []
		except Exception as exc:
			self.console_echo("Error showing IS graph files", "error", "Please report this issue on discord or GitHub and attach a debug-zip from the configurator.")
			logging.error(exc)
			self.debug_echo("SHOW_IS_GRAPH_FILES", str(exc))

	desc_CACHE_IS_GRAPH_FILES = "Caches the current is graph files"
	def cmd_CACHE_IS_GRAPH_FILES(self, gcmd):
		self.old_is_graph_files = self.get_is_graph_files()

	desc_RATOS_LOG = "G-code logging command "
	def cmd_RATOS_LOG(self, gcmd):
		prefix = gcmd.get('PREFIX')
		msg = gcmd.get('MSG')
		logging.info(prefix + ": " + msg)

	desc_RAISE_ERROR = "Raises an error when the macro is executed, unlike {action_raise_error()} which is executed when the macro is evaluated (rendered)"
	def cmd_RAISE_ERROR(self, gcmd):
		# This is implemented in python to avoid the unhelpful prefixing of the current macro name to the error message
		# when {action_raise_error()} is used in a [gcode_macro] template.
		msg = gcmd.get('MSG')
		raise self.printer.command_error(msg)

	desc_TRY = "Implements the try/except/finally pattern"
	def cmd_TRY(self, gcmd):
		command = gcmd.get("__COMMAND").strip()
		if not command:
			raise gcmd.error("Value for parameter '__COMMAND' must be specified")
		
		_except = gcmd.get("__EXCEPT", "").strip()
		_finally = gcmd.get("__FINALLY", "").strip()
		
		to_run = f'{command} {gcmd.get_raw_command_parameters()}'

		self.debug_echo("TRY", f"Command: {command}")
		self.debug_echo("TRY", f"Run: {to_run}")
		if _except:
			self.debug_echo("TRY", f"Except: {_except}")
		if _finally:
			self.debug_echo("TRY", f"Finally: {_finally}")

		try:
			self.gcode.run_script_from_command(to_run)
		except:
			if _except:
				try:
					self.gcode.run_script_from_command(_except)
				except Exception as ex:
					self.debug_echo("TRY", f"Except command failed: {str(ex)}")
			raise
		finally:
			if _finally:
				try:
					self.gcode.run_script_from_command(_finally)
				except Exception as ex:
					self.debug_echo("TRY", f"Finally command failed: {str(ex)}")

	desc_CHECK_BED_MESH_PROFILE_EXISTS = "Sets status last_check_bed_mesh_profile_exists_result to True if [bed_mesh] is configured and the specified profile exists, otherwise False."
	def cmd_CHECK_BED_MESH_PROFILE_EXISTS(self, gcmd):
		self.last_check_bed_mesh_profile_exists_result = False
		if self.bed_mesh:
			profile = gcmd.get('PROFILE', '')
			if not profile.strip():
				raise gcmd.error("Value for parameter 'PROFILE' must be specified")
			profiles = self.bed_mesh.pmgr.get_profiles()
			if profile in profiles:
				self.last_check_bed_mesh_profile_exists_result = True

	desc_PROCESS_GCODE_FILE = "G-code post-processor for IDEX and RMMU"
	def cmd_PROCESS_GCODE_FILE(self, gcmd):
		filename = gcmd.get('FILENAME', "")
		isIdex = self.dual_carriage is not None
		if filename[0] == '/':
			filename = filename[1:]
		self.gcode.run_script_from_command("SET_GCODE_VARIABLE MACRO=START_PRINT VARIABLE=first_x VALUE=-1")
		self.gcode.run_script_from_command("SET_GCODE_VARIABLE MACRO=START_PRINT VARIABLE=first_y VALUE=-1")
		if self.bypass_post_processing:
			self.bypass_post_processing = self.config.getboolean('bypass_post_processing', False)
			self.console_echo('Bypassing post-processing', 'info', 'Configuration option `bypass_post_processing` is set to true. Bypassing post-processing...')
			if isIdex:
				self.console_echo('Bypassing post-processing on IDEX machines is not recommended', 'warning', '_N_'.join([
					'RatOS IDEX features require gcode processing and transformation to be enabled.',
					'You can enable it by adding the following to printer.cfg._N_',
					'[ratos]',
					'bypass_post_processing: False',
					'enable_gcode_transform: True_N_'
				]))
			self.v_sd.cmd_SDCARD_PRINT_FILE(gcmd)
			return
		
		if self.process_gcode_file(filename, self.enable_gcode_transform):
			self.v_sd.cmd_SDCARD_PRINT_FILE(gcmd)
		else:
			self.console_echo('Print aborted', 'error')

	desc_RESET_Y_MAX_ADJUSTMENT = "Resets the adjustment of the maximum Y position. The adjustment is used only on IDEX machines when it's not possible to position the nozzle over the VAOC camera. Run INCREASE_Y_MAX to increase the maximum Y position by one millimeter each time it is run."
	def cmd_RESET_Y_MAX_ADJUSTMENT(self, gcmd):
		if not self.config.has_section("dual_carriage"):
			self.console_echo('Invalid machine type', 'error', 'This macro is only available on IDEX machines.')
			return
		main_config_path = self.printer.get_start_args()['config_file']
		if not main_config_path:
			raise self.printer.command_error("Could not determine the config path to update adjust-y-max.cfg")
		config_dir = os.path.dirname(main_config_path)		
		config_path = os.path.join(config_dir, 'ratos_generated', 'adjust-y-max.cfg')
		content = \
			'# WARNING. THIS FILE IS GENERATED BY RATOS AND\n' + \
			'# WILL BE UPDATED BY THE INCREASE_Y_MAX MACRO.\n' + \
			'# DO NOT DELETE OR MODIFY THIS FILE.\n'		
		try:
			os.makedirs(os.path.dirname(config_path), exist_ok=True)
			with open(config_path, 'w') as f:
				f.write(content)
		except Exception as e:
			self.console_echo('Failed to reset adjustment of maximum Y position', 'error', f'Could not write to {config_path}: {str(e)}')
			return		
		self.console_echo('Adjustment of maximum Y position reset', 'info', f'Successfully reset {config_path}_N_You must restart klipper for the changes to take effect, then run INCREASE_Y_MAX to perform the configuration.')
	
	desc_INCREASE_Y_MAX = "Increases the maximum Y position by one millimeter. Used only on IDEX machines when it's not possible to position the nozzle over the VAOC camera."
	def cmd_INCREASE_Y_MAX(self, gcmd):
		if not self.config.has_section("dual_carriage"):
			self.console_echo('Invalid machine type', 'error', 'This macro is only available on IDEX machines.')
			return
		self.gm_ratos = self.printer.lookup_object('gcode_macro RatOS')
		bed_margin_y = self.gm_ratos.variables.get('bed_margin_y')
		# bed_margin_y is expected to be [number, number]
		if bed_margin_y is None or not isinstance(bed_margin_y, list) or len(bed_margin_y) != 2 or not all(isinstance(v, (int, float)) for v in bed_margin_y):
			self.console_echo('Missing or invalid RatOS variable', 'error', 'The required [gcode_macro RatOS] variable_bed_margin_y is missing or invalid.')
			return
		if not self.config.has_section("stepper_y"):
			self.console_echo('Missing [stepper_y] section', 'error', 'The required [stepper_y] configuration section is missing.')
			return
		y = self.config.getsection("stepper_y")
		stepper_y_position_max = y.getfloat("position_max", default=None)
		stepper_y_position_endstop = y.getfloat("position_endstop", default=None)
		if stepper_y_position_max is None:
			self.console_echo('Missing configuration value', 'error', 'The required [stepper_y] position_max setting is missing from the configuration.')
			return
		if stepper_y_position_endstop is None:
			self.console_echo('Missing configuration value', 'error', 'The required [stepper_y] position_endstop setting is missing from the configuration.')
			return
		new_max_y = stepper_y_position_max + 1.0
		content = \
			'# WARNING. THIS FILE WAS GENERATED BY THE RATOS INCREASE_Y_MAX MACRO.\n' + \
			'# DO NOT DELETE OR MODIFY THIS FILE.\n' + \
			'#\n' + \
			'# To reset the adjustment, so that the default unadjusted value is used,\n' + \
			'# run the RESET_Y_MAX_ADJUSTMENT macro.\n' + \
			'\n' + \
			'[stepper_y]\n' + \
			f'position_max: {new_max_y:.3f}\n' + \
			'\n' + \
			'[gcode_macro RatOS]\n' + \
			f'variable_bed_margin_y: [{abs(stepper_y_position_endstop):.3f}, {bed_margin_y[1] + 1:.3f}]\n'				
		main_config_path = self.printer.get_start_args()['config_file']
		if not main_config_path:
			raise self.printer.command_error("Could not determine the config path to update adjust-y-max.cfg")		
		config_dir = os.path.dirname(main_config_path)		
		config_path = os.path.join(config_dir, 'ratos_generated', 'adjust-y-max.cfg')
		try:
			os.makedirs(os.path.dirname(config_path), exist_ok=True)
			with open(config_path, 'w') as f:
				f.write(content)
		except Exception as e:
			self.console_echo('Failed to update maximum Y position adjustment', 'error', f'Could not write to {config_path}: {str(e)}')
			return
		if str(gcmd.get('RESTART', '0')).strip().lower() in ('1', 'true', 'yes'):
			self.console_echo('Maximum Y position adjustment updated', 'info', f'Updated {config_path}_N_New maximum Y position is {new_max_y:.3f}._N_Restarting klipper to allow the changes to take effect...')
			# Request a restart
			gcode = self.printer.lookup_object('gcode')
			gcode.request_restart('restart')
		else:
			self.console_echo('Maximum Y position adjustment updated', 'info', f'Updated {config_path}_N_New maximum Y position is {new_max_y:.3f}._N_You must RESTART klipper for the changes to take effect.')

	desc_RESET_DC_ENDSTOP_CONFIGURATION = "Resets the dc-endstop.cfg configuration file, allowing reconfiguration of dual carriage endstop settings using the CONFIGURE_DC_ENDSTOP macro."
	def cmd_RESET_DC_ENDSTOP_CONFIGURATION(self, gcmd):
		if not self.config.has_section("dual_carriage"):
			self.console_echo('Invalid machine type', 'error', 'This macro is only available on IDEX machines.')
			return
		main_config_path = self.printer.get_start_args()['config_file']
		if not main_config_path:
			raise self.printer.command_error("Could not determine the config path to update dc-endstop.cfg")
		config_dir = os.path.dirname(main_config_path)		
		config_path = os.path.join(config_dir, 'ratos_generated', 'dc-endstop.cfg')
		content = \
			'# WARNING. THIS FILE IS GENERATED BY RATOS AND\n' + \
			'# WILL BE UPDATED BY THE CONFIGURE_DC_ENDSTOP MACRO.\n' + \
			'# DO NOT DELETE OR MODIFY THIS FILE.\n'		
		try:
			os.makedirs(os.path.dirname(config_path), exist_ok=True)
			with open(config_path, 'w') as f:
				f.write(content)
		except Exception as e:
			self.console_echo('Failed to reset DC endstop configuration', 'error', f'Could not write to {config_path}: {str(e)}')
			return		
		self.console_echo('DC endstop configuration reset', 'info', f'Successfully reset {config_path}_N_You must restart klipper for the changes to take effect, then run CONFIGURE_DC_ENDSTOP to perform the configuration.')

	desc_CONFIGURE_DC_ENDSTOP = "Updates the dc-endstop.cfg configuration file, configuring dual carriage endstop settings taking account of the last measured IDEX toolhead offsets (for example, from VAOC)."
	def cmd_CONFIGURE_DC_ENDSTOP(self, gcmd):		
		if not self.config.has_section("dual_carriage"):
			self.console_echo('Invalid machine type', 'error', 'This macro is only available on IDEX machines.')
			return

		self.gm_ratos = self.printer.lookup_object('gcode_macro RatOS')
		isConfigured = self.gm_ratos.variables.get('dc_endstop_is_configured', False) == True
		if isConfigured:
			self.console_echo(
				'DC endstop already configured', 'warning', 
				'The dual carriage endstop has already been configured. If you want to reconfigure it,_N_' + \
				'you must run the RESET_DC_ENDSTOP_CONFIGURATION macro first, then RESTART klipper, then run CONFIGURE_DC_ENDSTOP again.')
			return
		if not self.config.has_section("stepper_x"):
			self.console_echo('Missing [stepper_x] section', 'error', 'The required [stepper_x] configuration section is missing.')
			return		
		if not self.config.has_section("save_variables"):
			self.console_echo('Missing [save_variables] section', 'error', 'The required [save_variables] configuration section is missing.')
			return		
		dc = self.config.getsection("dual_carriage")
		x = self.config.getsection("stepper_x")

		stepper_x_position_max = x.getfloat("position_max", default=None)
		stepper_x_position_endstop = x.getfloat("position_endstop", default=None)
		dual_carriage_position_max = dc.getfloat("position_max", default=None)
		dual_carriage_position_endstop = dc.getfloat("position_endstop", default=None)

		if stepper_x_position_max is None:
			self.console_echo('Missing configuration value', 'error', 'The required [stepper_x] position_max setting is missing from the configuration.')
			return
		if stepper_x_position_endstop is None:
			self.console_echo('Missing configuration value', 'error', 'The required [stepper_x] position_endstop setting is missing from the configuration.')
			return
		if dual_carriage_position_max is None:
			self.console_echo('Missing configuration value', 'error', 'The required [dual_carriage] position_max setting is missing from the configuration.')
			return
		if dual_carriage_position_endstop is None:
			self.console_echo('Missing configuration value', 'error', 'The required [dual_carriage] position_endstop setting is missing from the configuration.')
			return

		svv = self.printer.lookup_object("save_variables", None)
		if svv is None:
			self.console_echo('save_variables object not found', 'error', 'The save_variables object was not found.')
			return
		svv = self.printer.lookup_object("save_variables").allVariables
		missingKeys = []
		for key in ('idex_xoffset', 'idex_xcontrolpoint', 'idex_ycontrolpoint'):
			if not key in svv:
				missingKeys.append(key)
		if len(missingKeys) > 0:
			self.console_echo('Missing saved variable(s)', 'error', 'The following required saved variable(s) are missing: ' + ', '.join(missingKeys) + '. Please run the VAOC calibration first.')
			return
		idex_xoffset = float(svv['idex_xoffset'])
		idex_xcontrolpoint = float(svv['idex_xcontrolpoint'])
		idex_ycontrolpoint = float(svv['idex_ycontrolpoint'])

		# It's not practical to reliably detect if the user has done the old-style cut-and-paste configuration, so always warn about it.
		self.console_echo(
			'Legacy configuration', 'warning',
			'Note: this does not apply to fresh installations of RatOS._N__N_' + \
			'If you have previously configured the dual carriage endstop using the old CALCULATE_DC_ENDSTOP macro_N_' + \
			'followed by pasting the output into printer.cfg, you MUST remove the configuration you pasted,_N_' + \
			'then reset and reconfigure the new-style configuration as follows: _N_' + \
			'Run the RESET_DC_ENDSTOP_CONFIGURATION macro, then RESTART klipper, then run CONFIGURE_DC_ENDSTOP again.')

		content = \
			'# WARNING. THIS FILE WAS GENERATED BY THE RATOS CONFIGURE_DC_ENDSTOP MACRO.\n' + \
			'# DO NOT DELETE OR MODIFY THIS FILE.\n' + \
			'#\n' + \
			'# To reconfigure:\n' + \
			'# 1. Run the RESET_DC_ENDSTOP_CONFIGURATION macro which will reset this file.\n' + \
			'# 2. RESTART klipper, so the reset changes take effect.\n' + \
			'# 3. Run the CONFIGURE_DC_ENDSTOP macro to perform the configuration.\n' + \
			'# 4. RESTART klipper again to apply the new configuration\n' + \
			'\n' + \
			'[dual_carriage]\n' + \
			f'position_max: {dual_carriage_position_max + idex_xoffset:.3f}\n' + \
			f'position_endstop: {dual_carriage_position_endstop + idex_xoffset:.3f}\n' + \
			'\n' + \
			'[gcode_macro RatOS]\n' + \
			'variable_dc_endstop_is_configured: True\n' + \
			f'variable_bed_margin_x: [{abs(stepper_x_position_endstop):.3f}, {dual_carriage_position_max - stepper_x_position_max + idex_xoffset:.3f}]\n' + \
			'\n' + \
			'[gcode_macro _VAOC]\n' + \
			f'variable_expected_camera_x_position: {idex_xcontrolpoint:.3f}\n' + \
			f'variable_expected_camera_y_position: {idex_ycontrolpoint:.3f}\n' + \
			'\n' + \
			'[gcode_macro T0]\n' + \
			f'variable_parking_position: {stepper_x_position_endstop + 2:.3f}\n' + \
			'\n' + \
			'[gcode_macro T1]\n' + \
			f'variable_parking_position: {dual_carriage_position_endstop + idex_xoffset - 2:.3f}\n'

		main_config_path = self.printer.get_start_args()['config_file']
		if not main_config_path:
			raise self.printer.command_error("Could not determine the config path to update dc-endstop.cfg")
		config_dir = os.path.dirname(main_config_path)		
		config_path = os.path.join(config_dir, 'ratos_generated', 'dc-endstop.cfg')
		existing_content = None
		if os.path.exists(config_path):
			try:
				with open(config_path, 'r') as f:
					existing_content = f.read()
			except Exception:
				pass
		if existing_content == content:
			self.console_echo('DC endstop configuration is up to date', 'info', f'No changes were made to dc-endstop.cfg at {config_path}.')
			return
		try:
			os.makedirs(os.path.dirname(config_path), exist_ok=True)
			with open(config_path, 'w') as f:
				f.write(content)
		except Exception as e:
			self.console_echo('Failed to update DC endstop configuration', 'error', f'Could not write to {config_path}: {str(e)}')
			return
		if str(gcmd.get('RESTART', '0')).strip().lower() in ('1', 'true', 'yes'):
			self.console_echo('DC endstop configuration updated', 'info', f'Updated {config_path}_N_Restarting klipper to allow the changes to take effect...')
			# Request a restart
			gcode = self.printer.lookup_object('gcode')
			gcode.request_restart('restart')
		else:
			self.console_echo('DC endstop configuration updated', 'info', f'Updated {config_path}_N_You must RESTART klipper for the changes to take effect.')

	#####
	# Gcode Post Processor
	#####
	def process_gcode_file(self, filename, enable_gcode_transform):
		try:
			[path, size] = self.get_gcode_file_info(filename)
			# Start ratos postprocess command
			args = ['ratos', 'postprocess', '--non-interactive']
			isIdex = self.config.has_section("dual_carriage")

			if enable_gcode_transform:
				args.append('--overwrite-input')
			if isIdex:
				args.append('--idex')
			if self.allow_unknown_gcode_generator:
				args.append('--allow-unknown-generator')
			if self.allow_unsupported_slicer_versions:
				args.append('--allow-unsupported-slicer-versions')
			args.append(path)
			
			if not enable_gcode_transform and isIdex:
				self.console_echo('Post-processing on IDEX machines without gcode transformation is not recommended', 'warning', '_N_'.join([
					'RatOS IDEX features require gcode transformation to be enabled.',
					'You can enable it by adding the following to printer.cfg._N_',
					'[ratos]',
					'enable_gcode_transform: True_N_'
				]))

			logging.info('Post-processing started via RatOS CLI: ' + str(args))
			self.console_echo('Post-processing started', 'info',  'Processing %s (%.2f mb)...' % (filename, size / 1024 / 1024));

			process = subprocess.Popen(
				args,
				stdout=subprocess.PIPE,
				stderr=subprocess.PIPE
			)

			self.partial_output = ""
			reactor = self.printer.get_reactor()
			def _interpret_output(data):
				# Handle the parsed data
				if data['result'] == 'error' and 'message' in data:
					self.last_processed_file_result = None
					self.console_echo("Error: " + data['title'], 'alert', data['message'])
					
					if data['code'] == 'UNKNOWN_GCODE_GENERATOR':
						message = '_N_'.join([
							'You can allow gcode from unknown generators by running <a class="command">ALLOW_UNKNOWN_GCODE_GENERATOR</a> in the console before starting a print',
							'Keep in mind that this may cause unexpected behaviour, but it can be useful for calibration prints',
							'such as the ones found in <a href="https://ellis3dp.com/Print-Tuning-Guide/">Ellis\' Print Tuning Guide</a>.'
						])
						self.console_echo('Do you want to allow gcode from unknown generators/slicers?', 'info', message)

					return False

				if data['result'] == 'warning' and 'message' in data:
					self.console_echo("Warning: " + data['title'], 'warning', data['message'])

				if data['result'] == 'success':
					self.last_processed_file_result = data['payload']
					printability = data['payload']['printability']

					if printability == 'PROCESSOR_NOT_SUPPORTED':
						self.console_echo('Post-processing Error: file was processed by an obsolete or future version of the RatOS postprocessor', 'error', "You can bypass the processor for this file by running BYPASS_GCODE_PROCESSING before starting the print, but there is no guarantee that it will print correctly._N__N_Reasons for failure:_N_ %s" % ("_N_".join(data['payload']['printabilityReasons'])))
						return False

					if printability == 'NOT_SUPPORTED':
						self.console_echo('Post-processing Error: slicer version not supported', 'error', "You can allow unsupported slicers by adding the following to printer.cfg._N__N_[ratos]_N_allow_unsupported_slicer_versions: True_N__N_Reasons for failure:_N_ %s" % ("_N_".join(data['payload']['printabilityReasons'])))
						return False
						
					if printability == 'MUST_REPROCESS':
						self.console_echo('Post-processing Error: file must be reprocessed', 'error', 'File must be reprocessed before it can be printed, please slice and upload the unprocessed file again._N_Reasons for failure:_N_ %s' % ("_N_".join(data['payload']['printabilityReasons'])))
						return False

					if printability == "UNKNOWN" and data['payload']['generator'] == "unknown" and self.allow_unknown_gcode_generator:
						self.console_echo('Post-processing skipped', 'info', 'File contains gcode from an unknown/unidentified generator._N_Post processing has been skipped since gcode from unknown generators is allowed in your configuration.')
						self.post_process_success = True
						return True
					
					if printability != 'READY':
						self.console_echo('Post-processing Error: file is not ready to be printed', 'error', '%s_N_File is not ready to be printed, please slice and upload the unprocessed file again._N_Reasons for failure:_N_ %s' % ("_N_".join(data['payload']['printabilityReasons'])))
						return False

					analysis_result = data['payload']['analysisResult']
					if not analysis_result:
						self.console_echo('Post-processing Error: no analysis result', 'error', 'No analysis result found, something is wrong... Please report this issue on GitHub and attach a debug-zip from the configurator, along with the file you tried to print.')
						return False

					if 'firstMoveX' in analysis_result:
						self.gcode.run_script_from_command("SET_GCODE_VARIABLE MACRO=START_PRINT VARIABLE=first_x VALUE=" + str(analysis_result['firstMoveX']))
					if 'firstMoveY' in analysis_result:
						self.gcode.run_script_from_command("SET_GCODE_VARIABLE MACRO=START_PRINT VARIABLE=first_y VALUE=" + str(analysis_result['firstMoveY']))

					tool_shifts = analysis_result["toolChangeCount"] if "toolChangeCount" in analysis_result else 0
					used_tools = analysis_result["usedTools"] if "usedTools" in analysis_result else "0"
					
					success_msg_lines = [
						f'Slicer: {data["payload"]["generator"]} v{data["payload"]["generatorVersion"]} '
						f'_N_Used tools: T{", T".join(used_tools)}',
					]
					if tool_shifts > 0:
						success_msg_lines.append(f'_N_Toolshifts: {tool_shifts}')

					self.console_echo(
						'Post-processing completed', 
						'success',
						"_N_".join(success_msg_lines)
					)
					self.post_process_success = True
					return True

				if data['result'] == 'progress':
					eta_secs = data['payload']['eta']

					if eta_secs < 60:
						eta_str = f"{eta_secs}s"
					elif eta_secs < 3600:
						mins = eta_secs // 60
						secs = eta_secs % 60
						eta_str = f"{mins}m {secs}s"
					else:
						hours = eta_secs // 3600
						mins = (eta_secs % 3600) // 60
						secs = eta_secs % 60
						eta_str = f"{hours}h {mins}m {secs}s"

					if data['payload']['percentage'] < 100:
						self.console_echo(f"Post-processing ({data['payload']['percentage']}%)... {eta_str} remaining", 'info')
					else:
						self.console_echo(f"Post-processing ({data['payload']['percentage']}%)...", 'info')

				if data['result'] == 'waiting':
					self.console_echo('Post-processing waiting', 'info', 'Waiting for input file to finish being written...')


			def _process_output(eventtime):
				if process.stdout is None:
					return
				try:
					data = os.read(process.stdout.fileno(), 4096)
				except Exception:
					return

				data = self.partial_output + data.decode()
				
				if '\n' not in data:
					self.partial_output = data
					return
				elif data[-1] != '\n':
					split = data.rfind('\n') + 1
					self.partial_output = data[split:]
					data = data[:split]
				else:
					self.partial_output = ""

				for line in data.splitlines():
					try:
						# Parse JSON from each line
						json_data = json.loads(line)
						if not 'result' in json_data:
							continue
						_interpret_output(json_data)
					except json.JSONDecodeError:
						# Skip lines that aren't valid JSON
						logging.warning("RatOS postprocessor: Invalid JSON line: " + line)

			# Reset post-processing success flag
			self.post_process_success = False

			# Register file descriptor with reactor
			hdl = reactor.register_fd(process.stdout.fileno(), _process_output)

			# Wait for process completion with timeout
			eventtime = reactor.monotonic()
			endtime = eventtime + 3600.0 # 30 minute timeout
			complete = False

			while eventtime < endtime:
				eventtime = reactor.pause(eventtime + .05)
				if process.poll() is not None:
					complete = True
					break

			# Cleanup
			reactor.unregister_fd(hdl)
			if not complete:
				process.terminate()
				self.console_echo("Post-processing failed", "error", "Post processing timed out after 30 minutes.")
				return False

			if process.returncode != 0:
				# We should've already printed the error message in _interpret_output
				error = process.stderr.read().decode().strip()
				if error:
					logging.error(error)

				self.post_process_success = False
				return False

			return self.post_process_success

		except Exception as e:
			raise
		return self.post_process_success;


	def get_gcode_file_info(self, filename):
		files = self.v_sd.get_file_list(True)
		flist = [f[0] for f in files]
		files_by_lower = { filepath.lower(): [filepath, fsize] for filepath, fsize in files }
		filepath = filename
		try:
			if filepath not in flist:
				filepath = files_by_lower[filepath.lower()]
				return filepath
			fullpath = os.path.join(self.sdcard_dirname, filepath);
			return [fullpath, os.path.getsize(fullpath)]
		except:
			raise self.printer.command_error("Can not get path for file " + filename)

	#####
	# Helper
	#####
	def ratos_echo(self, prefix, msg):
		self.gcode.run_script_from_command("RATOS_ECHO PREFIX='" + str(prefix) + "' MSG='" + str(msg).replace("'", "`").replace("\n", "_N_") + "'")

	def debug_echo(self, prefix, msg):
		self.gcode.run_script_from_command("DEBUG_ECHO PREFIX='" + str(prefix) + "' MSG='" + str(msg).replace("'", "`").replace("\n", "_N_") + "'")
	
	def console_echo(self, title, type, msg=''):
		color = "white"
		opacity = 1.0
		if type == 'info': color = "#38bdf8"
		if type == 'success': color = "#a3e635"
		if type == 'warning': color = "#fbbf24"
		if type == 'alert': color = "#f87171"
		if type == 'error': color = "#f87171"
		if type == 'debug': color = "#38bdf8"
		if type == 'debug': opacity = 0.7

		msg = msg.replace("_N_","\n")

		if (type == 'error' or type == 'alert'):
			logging.error(title + ": " + msg)
			self.display_status.message = f"ERROR: {title} (check the console for details)"
		if (type == 'warning'):
			logging.warning(title + ": " + msg)
			self.display_status.message = f"WARNING: {title} (check the console for details)"

		_title = '<p style="font-weight: bold; margin:0; opacity:' + str(opacity) + '; color:' + color + '">' + title + '</p>'
		if msg:
			_msg = '<p style="margin:0; opacity:' + str(opacity) + '; color:' + color + '">' + msg + '</p>'
		else:
			_msg = ''

		self.gcode.respond_raw('<div>' + _title + _msg + '</div>')

	def get_is_graph_files(self):
		try:
			folder_path = r"/home/pi/printer_data/config/input_shaper/"
			file_type = r"*.png"
			return glob.glob(os.path.join(folder_path, file_type))
		except Exception as exc:
			self.debug_echo("get_is_graph_files", "Something went wrong. " + str(exc))
		return None		

	def get_ratos_version(self):
		version = '?'
		path = pathlib.Path('/home/pi/ratos-configurator/.git')
		gitdir = os.path.join(path, '..')
		prog_desc = ('git', '-C', gitdir, 'describe', '--always',
					'--tags', '--long', '--dirty')
		prog_status = ('git', '-C', gitdir, 'status', '--porcelain', '--ignored')
		try:
			process = subprocess.Popen(prog_desc, stdout=subprocess.PIPE,
									stderr=subprocess.PIPE)
			ver, err = process.communicate()
			retcode = process.wait()
			if retcode == 0:
				version = str(ver.strip().decode())
				process = subprocess.Popen(prog_status, stdout=subprocess.PIPE,
										stderr=subprocess.PIPE)
				retcode = process.wait()
				return version
			else:
				self.debug_echo("get_ratos_version", ("Error getting git version: %s", err))
		except Exception as exc:
			self.debug_echo("get_ratos_version", ("Exception on run: %s", exc))
		return version

	def get_beacon_probing_regions(self) -> BeaconProbingRegions:
		"""Gets the probing regions configuration for the Beacon probe, or None if not available.
		Returns:
			BeaconProbingRegions or None: A named tuple containing:
				- x_offset: X offset of the Beacon probe
				- y_offset: Y offset of the Beacon probe
				- proximity_min: Tuple of (min_x, min_y) for proximity probing
				- proximity_max: Tuple of (max_x, max_y) for proximity probing
				- contact_min: Tuple of (min_x, min_y) for contact probing
				- contact_max: Tuple of (max_x, max_y) for contact probing
			Returns None if bed_mesh or beacon configuration is not available.
		"""
		if self.beacon is None:
			return None
		
		return BeaconProbingRegions(
			x_offset=self.beacon.x_offset,
			y_offset=self.beacon.y_offset,
			proximity_min=(self.beacon.mesh_helper.def_min_x, self.beacon.mesh_helper.def_min_y),
			proximity_max=(self.beacon.mesh_helper.def_max_x, self.beacon.mesh_helper.def_max_y),
			contact_min=tuple(self.beacon.mesh_helper.def_contact_min),
			contact_max=tuple(self.beacon.mesh_helper.def_contact_max))

	def get_safe_home_position(self):
		printable_x_max = float(self.gm_ratos.variables['printable_x_max'])
		printable_y_max = float(self.gm_ratos.variables['printable_y_max'])
		raw_safe_home_x = safe_home_x = self.gm_ratos.variables.get('safe_home_x', None)
		raw_safe_home_y = safe_home_y = self.gm_ratos.variables.get('safe_home_y', None)
		safe_home_x = printable_x_max / 2 if safe_home_x is None or str(safe_home_x).lower() == 'middle' else float(safe_home_x)
		safe_home_y = printable_y_max / 2 if safe_home_y is None or str(safe_home_y).lower() == 'middle' else float(safe_home_y)
		
		bpr = self.get_beacon_probing_regions()
		if bpr is not None:
			safe_min_x = max(bpr.proximity_min[0], bpr.contact_min[0])
			safe_max_x = min(bpr.proximity_max[0], bpr.contact_max[0])
			safe_min_y = max(bpr.proximity_min[1], bpr.contact_min[1])
			safe_max_y = min(bpr.proximity_max[1], bpr.contact_max[1])
			if safe_home_x < safe_min_x or safe_home_x > safe_max_x or safe_home_y < safe_min_y or safe_home_y > safe_max_y:
				if not self.printer.is_shutdown():
					logging.info(f"{self.name}: (safe_home_x, safe_home_y) is not within beacon-probable region: printable_x_max={printable_x_max}, printable_y_max={printable_y_max}, safe_home_x={safe_home_x}, safe_home_y={safe_home_y}, raw_safe_home_x={raw_safe_home_x}, raw_safe_home_y={raw_safe_home_y}, beacon probing region: ({safe_min_x}, {safe_min_y}) - ({safe_max_x}, {safe_max_y})")
					self.printer.invoke_shutdown(f"{self.name}: (safe_home_x, safe_home_y) must be within the region that Beacon can probe: ({safe_min_x}, {safe_min_y}) - ({safe_max_x}, {safe_max_y}). The configured location ({safe_home_x:.2f}, {safe_home_y:.2f}) is outside this region.")			
		
		return (safe_home_x, safe_home_y)

	desc_MOVE_TO_SAFE_Z_HOME = "Move to safe home position with optional Z_HOP (pass Z_HOP=True as parameter)"
	def cmd_MOVE_TO_SAFE_Z_HOME(self, gcmd):
		speed = float(self.gm_ratos.variables['macro_travel_speed']) * 60
		fuzzy_radius = gcmd.get_float('FUZZY_RADIUS', 0, minval=0.)
		z_hop = gcmd.get('Z_HOP', '').lower() in ('true', 'yes', '1')
		x, y = self.get_safe_home_position()
		
		if fuzzy_radius > 0:
			# Set the home position to a random point anywhere within the circle centered on the safe home position
			# Generate random radius between 0 and fuzzy_radius (sqrt of random ensures uniform distribution)
			random_radius = fuzzy_radius * math.sqrt(random.random())
			# Generate random angle
			angle = random.uniform(0, 2 * math.pi)
			# Calculate new position
			x += random_radius * math.cos(angle)
			y += random_radius * math.sin(angle)

			# Limit to the beacon probing region if defined
			bpr = self.get_beacon_probing_regions()
			if bpr is not None:
				safe_min_x = max(bpr.proximity_min[0], bpr.contact_min[0])
				safe_max_x = min(bpr.proximity_max[0], bpr.contact_max[0])
				safe_min_y = max(bpr.proximity_min[1], bpr.contact_min[1])
				safe_max_y = min(bpr.proximity_max[1], bpr.contact_max[1])
				constrained_x = max(safe_min_x, min(x, safe_max_x))
				constrained_y = max(safe_min_y, min(y, safe_max_y))
			else:
				# Limit to printable area if no beacon probing region is defined
				printable_x_max = float(self.gm_ratos.variables['printable_x_max'])
				printable_y_max = float(self.gm_ratos.variables['printable_y_max'])
				constrained_x = max(0, min(x, printable_x_max))
				constrained_y = max(0, min(y, printable_y_max))

			if (constrained_x, constrained_y) != (x, y):
				logging.warning(f"{self.name}: _MOVE_TO_SAFE_Z_HOME: fuzzy position had to be constrained to fit within the printable or beacon probing regions, the intended fuzzy behaviour may not be achieved.")
				x, y = constrained_x, constrained_y

		if z_hop:
			self.gcode.run_script_from_command("_Z_HOP")

		self.gcode.run_script_from_command(f"__MOVE_TO_SAFE_Z_HOME_ECHO_DEBUG X={x} Y={y} FUZZY_RADIUS={fuzzy_radius} Z_HOP={z_hop}")
		self.gcode.run_script_from_command(f"G0 X{x} Y{y} F{speed}")

		self.last_move_to_safe_z_home_position = (x, y)

	def get_status(self, eventtime=None):
		return {
			'name': self.name,
			'last_processed_file_result': self.last_processed_file_result,
			'last_check_bed_mesh_profile_exists_result': self.last_check_bed_mesh_profile_exists_result,
			# The configured safe home position
			'safe_home_position': self.get_safe_home_position(),
			# The last position moved to by _MOVE_TO_SAFE_Z_HOME, which may differ from safe_home_position
			# if FUZZY_RADIUS was used.
			'last_move_to_safe_z_home_position': self.last_move_to_safe_z_home_position }

	#####
	# Stack trace
	#####

	_rx_stack_crawl_ = re.compile(r";\$(\S+)")
	desc_DEBUG_ECHO_STACK_TRACE = "Logs a gcode command stack trace when debug is enabled. Add comments to template macros formatted exactly {';$some-short-text-without-whitespace'} to enhance callsite identification."
	def cmd_DEBUG_ECHO_STACK_TRACE(self, gcmd):
		macro = self.printer.lookup_object('gcode_macro DEBUG_ECHO')
		if macro.variables['enabled']:			
			def callback(frame_info):
				locals = frame_info.frame.f_locals
				self_obj = locals.get("self", None)
				if self_obj:
					if isinstance(self_obj, type(macro)):
						f_gcmd = locals.get('gcmd',None)
						if f_gcmd:
							return (False,f"    {f_gcmd.get_commandline()}")
						return (False,f"    {self_obj.alias}")
					if type(self_obj).__name__ == 'GCodeDispatch':
						f_commands = locals.get('commands', None)
						f_origline = locals.get('origline', None)
						if f_commands and f_origline:
							def format_with_preceding_crawlmark(index):
								for index2, line2 in enumerate(f_commands[index::-1]):
									match = self._rx_stack_crawl_.search(line2)
									if match:
										return f"{match.group(1)}+{index2}" if index2 > 0 else match.group(1)
								return str(index)
							matches = []
							for index, line in enumerate(f_commands):
								if f_origline is line:
									matches = [format_with_preceding_crawlmark(index)]
									break
								if f_origline == line.strip():
									matches.append(format_with_preceding_crawlmark(index))
							if matches:
								return (False,f"      from line {' or '.join(matches)} of:")
				gcmd_args = self.get_function_arguments_of_type(frame_info, 'GCodeCommand')
				if len(gcmd_args) == 1:
					return (True,f"    {gcmd_args[0][1].get_commandline()}")
				return (False, None)
			msg = self.get_formatted_extended_stack_trace(callback, 0)
			self.console_echo("RATOS_STACK_TRACE", "debug", msg)
			logging.info("RATOS_STACK_TRACE" + "\n" + msg)

	# Helper for get_formatted_extended_stack_trace callbacks.
	@staticmethod
	def get_function_arguments_of_type(frame_info, type_name):
		function_name = frame_info.function  # Get the function name
		if function_name:
			locals = frame_info.frame.f_locals
			function_object = frame_info.frame.f_globals.get(function_name, None)  # Retrieve the function object
			if function_object:
				signature = inspect.signature(function_object)  # Get the function signature
				return [(name, locals.get(name,None)) for name in signature.parameters.keys() if type(locals.get(name, None)).__name__ == type_name]
		return []

	@staticmethod
	def get_formatted_extended_stack_trace(callback=None, skip=0):
		"""
		Capture the current stack, format it like traceback.format_list,
		and for each frame allow a callback (if provided) to add extra lines.
		
		Parameters:
		callback (function): A function that takes an inspect.FrameInfo object
							and returns a string containing extra info (or '' if none).
		skip (int): Number of frames to skip from the bottom of the stack.
					For example, skip=1 will omit the current frame.
		
		Returns:
		str: The formatted multi-line string of the stack trace plus any extra info.
		"""
		# Get the current stack. Using inspect.stack() returns a list where each
		# element is an inspect.FrameInfo object.
		# We skip the first few frames (including this function itself) using skip.
		stack = inspect.stack()[skip+1:]
		lines = []
		
		for frame_info in stack:
			# Convert each inspect.FrameInfo to a FrameSummary, which is what
			# traceback.format_list expects. This lets us format it the usual way.
			code_line = frame_info.code_context[0].strip() if frame_info.code_context else None
			frame_summary = traceback.FrameSummary(frame_info.filename, frame_info.lineno, frame_info.function, line=code_line)
						
			# If a callback is provided, get extra information from it.
			should_emit, extra_lines  = callback(frame_info) if callback is not None else (True, None)
			if should_emit:
				# Format the frame like traceback.format_list
				lines.extend(traceback.format_list([frame_summary]))

			if extra_lines:
				# Append the extra info as extra lines
				lines.append(extra_lines + "\n")
		
		return "".join(lines)
	
	def get_cpu_governors(self) -> set[str]:
		"""Return the set of distinct current CPU governor names (lowercased).

		Reads all `/sys/devices/system/cpu/cpu*/cpufreq/scaling_governor` files and
		returns a set containing the distinct governor names converted to lower
		case. If CPU frequency scaling is unavailable or no readable values are
		found, an empty set is returned. Multiple differing governors are accepted
		and will be returned as multiple items in the set.
		"""
		cpu_glob = "/sys/devices/system/cpu/cpu*/cpufreq/scaling_governor"
		files = glob.glob(cpu_glob)
		if not files:
			logging.warning(f"{self.name}: expected CPU governor device files not found: {cpu_glob}")
			raise FileNotFoundError(f"expected CPU governor operating system device files not found")

		governors = set()
		for path in files:
			try:
				with open(path, 'r') as fh:
					val = fh.read().strip().lower()
					if val:
						governors.add(val)
			except Exception as e:
				logging.warning(f"{self.name}: failed to read operating system device file at {path}: {e}")
				raise IOError(f"failed to read operating system device file at {path}: {e}") from e

		if not governors:
			logging.error(f"{self.name}: Failed to read any CPU governor values")
			raise ValueError("failed to read any CPU governor values")			

		logging.info(f"{self.name}: Current CPU governor(s): {', '.join(sorted(governors))}")
		return governors
	
	desc_BEACON_CHECK_DIRECTIONAL_REPEATABILITY = "For diagnostics: perform a series of probe points to check the repeatability of the Beacon probe."
	def cmd_BEACON_CHECK_DIRECTIONAL_REPEATABILITY(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon probe not configured")
		
		proceed = gcmd.get('PROCEED', '').lower() in ('true', 'yes', '1')
		if not proceed:
			self.console_echo('BEACON_CHECK_DIRECTIONAL_REPEATABILITY', 'info', 
				'_N_'.join([
					'This command will perform a series of probe points to check the repeatability',
					'of the Beacon probe. Before proceeding:',
					'- Ensure that the printer is fully commissioned and mechanically sound.',
					'- Ensure that the print sheet (eg, PEI spring steel sheet) is in place, and',
					'  is clean and free of debris.',
					'- Ensure the nozzle is clean and free of filament residue.',
					'- Ensure the printer is in a stable thermal state so that test results are not',
					'  affected by thermal or dimensional changes. Typically this means leaving the',
					'  printer open and unheated at room temperature for at least 2 hours, unless you',
					'  are specifically testing under heated conditions.',
					'- Ensure there are no drafts or vibrations that could affect the probe readings,'
					'  unless you are specifically testing under such conditions.',
					'',
					'Run the command again with PROCEED=YES to actually run the test.'
				]))
			return

		accel = gcmd.get_float('ACCEL', 4000., minval=100.)
		cycles = gcmd.get_int('CYCLES', 5, minval=1)
		divisions = gcmd.get_int('DIVISIONS', 8, minval=4)
		speed = gcmd.get_float('SPEED', 300., minval=10.)

		self.console_echo('BEACON_CHECK_DIRECTIONAL_REPEATABILITY', 'info', 
			'_N_'.join([
				f'Running {cycles} cycles of {divisions} divisions at {speed} mm/s, {accel} mm/s² acceleration.',
				'This may take several minutes, please wait...'
			]))
			
		self.gcode.run_script_from_command("MAYBE_HOME ABL=1\nSAVE_GCODE_STATE NAME=_BEACON_CHECK_REPEATABILITY")
		try:			
			x, y = self.get_safe_home_position()
			self._beacon_check_directional_repeatability(gcmd, x, y, cycle_count=cycles, divisions=divisions, accel=accel, speed_mms=speed)
		finally:
			self.gcode.run_script_from_command("RESTORE_GCODE_STATE NAME=_BEACON_CHECK_REPEATABILITY")

	def _beacon_check_directional_repeatability(self, gcmd, x: float, y: float, *, cycle_count: int = 10, distance: float = 50., speed_mms: float = 300., accel: float = 4000., divisions: int = 8, timestamp = None):
		# For each cycle:
		#   For each division around a circle centered on (x, y):
		#     Move out to the point at distance along that angle
		#	  Move back to center and probe
		#     Record the probe result
		# After all cycles, compute statistics for each division
		# and report results.
		speed_f = speed_mms * 60
		# Move to start position
		self.gcode.run_script_from_command(f"_Z_HOP\nG0 X{x} Y{y} F{speed_f}")
		self.gcode.run_script_from_command(f"SET_VELOCITY_LIMIT ACCEL={accel}")
		results = []
		for cycle in range(cycle_count):
			for division in range(divisions):
				angle_rad = math.pi/2 - (2.0 * math.pi / divisions) * division
				target_x = x + distance * math.cos(angle_rad)
				target_y = y + distance * math.sin(angle_rad)
				# Move out to target
				self.gcode.run_script_from_command(f"G0 X{target_x} Y{target_y} F{speed_f}")
				# Move back to center
				self.gcode.run_script_from_command(f"G0 X{x} Y{y} F{speed_f}")
				# Probe
				self.gcode.run_script_from_command("PROBE PROBE_METHOD=contact SAMPLES=1 SAMPLES_DROP=0")
				# Get last probe result
				last_z = self.beacon.last_z_result
				results.append( (division, last_z) )
				
		stats_by_division = {}
		
		def get_stats_below_percentile(arr, p):
			pc = np.percentile(arr, p)
			pc_below = arr[arr <= pc]
			if len(pc_below) == 0:
				return {
					'mean': None,
					'stddev': None,
					'min': None,
					'max': None,
					'range': None,
					'count': 0
				}
			return {
				'mean': round(float(np.mean(pc_below)), 4),
				'stddev': round(float(np.std(pc_below)), 4),
				'min': round(float(np.min(pc_below)), 4),
				'max': round(float(np.max(pc_below)), 4),
				'range': round(float(np.max(pc_below) - np.min(pc_below)), 4),
				'count': len(pc_below)
			}

		for division in range(divisions):
			division_results = [z for (div, z) in results if div == division]
			arr = np.array(division_results)
			stats_by_division[division] = {
				# angle, where 0 is +Y axis and increases clockwise
				'angle': (360.0 / divisions) * division,
				'<=30pc': get_stats_below_percentile(arr, 30),
				'<=50pc': get_stats_below_percentile(arr, 50),
				'<=85pc': get_stats_below_percentile(arr, 85),
				'all': get_stats_below_percentile(arr, 100),
			}
			self.reactor.pause(self.reactor.monotonic() + 0.1)
		
		def format_stats(stats):
			mean = f"{stats['mean']*1000.:7.0f}"  if stats['mean']  is not None else f"{'-':>7}"
			sd   = f"{stats['stddev']*1000.:7.1f}" if stats['stddev'] is not None else f"{'-':>7}"
			mn   = f"{stats['min']*1000.:7.0f}"    if stats['min']    is not None else f"{'-':>7}"
			mx   = f"{stats['max']*1000.:7.0f}"    if stats['max']    is not None else f"{'-':>7}"
			rng  = f"{stats['range']*1000.:7.0f}"  if stats['range']  is not None else f"{'-':>7}"
			return mean, sd, mn, mx, rng
		
		def format_angle(angle):
			prefix = ''
			if math.isclose(angle, 0):
				prefix = '+Y'
			elif math.isclose(angle, 90):
				prefix = '+X'
			elif math.isclose(angle, 180):
				prefix = '-Y'
			elif math.isclose(angle, 270):
				prefix = '-X'
			return f"{prefix}{angle:>8.0f}" if prefix else f"{angle:>10.0f}"			
		
		header = f"| {'Angle (°)':>10} {'Count':>6} {'Mean':>7} {'StdDev':>7} {'Min':>7} {'Max':>7} {'Range':>7} (µm)"
		for pc_label, pc in (('<=30pc', 30), ('<=50pc', 50), ('<=85pc', 85), ('all', 100)):
			table_lines = []
			table_lines.append(header)
			for division in range(divisions):
				stats = stats_by_division[division][pc_label]
				angle = stats_by_division[division]['angle']
				count = stats['count']
				mean, sd, mn, mx, rng = format_stats(stats)
				line = f"| {format_angle(angle)} {count:>6d} {mean} {sd} {mn} {mx} {rng}"
				table_lines.append(line)

			# Add a final line showing the stats for all divisions combined
			all_results = [z for (div, z) in results]
			arr = np.array(all_results)
			all_stats = get_stats_below_percentile(arr, pc)
			mean, sd, mn, mx, rng = format_stats(all_stats)
			count = all_stats['count']
			line = f"| {'ALL':>10} {count:>6d} {mean} {sd} {mn} {mx} {rng}"
			table_lines.append(line)
			
			table_str = "\n".join(table_lines)
			
			gcmd.respond_info(f'({x:.0f}, {y:.0f}) {cycle_count} x {distance} mm @ {speed_mms} mm/s @ {accel} mm/s² {pc_label}:\n\n{table_str}')
		
		self.reactor.pause(self.reactor.monotonic() + 0.1)
		
		json_output = {
			'x_center': x,
			'y_center': y,
			'cycle_count': cycle_count,
			'distance': distance,
			'speed_mms': speed_mms,
			'accel': accel,
			'divisions': divisions,
			'stats': stats_by_division,
			'results': {
				division: [z for (div, z) in results if div == division]
				for division in range(divisions)
			}
		}

		json_str = json.dumps(json_output, indent=4)
		self.reactor.pause(self.reactor.monotonic() + 0.1)

		timestamp_str = time.strftime("%Y%m%d_%H%M%S", timestamp or time.localtime())
		config_file = self.printer.get_start_args()['config_file']
		config_dir = os.path.dirname(config_file)
		diag_dir = os.path.join(config_dir, 'diagnostics')
		
		if not os.path.exists(diag_dir):
			try:
				os.makedirs(diag_dir)
			except Exception as e:
				self.console_echo('BEACON_CHECK_DIRECTIONAL_REPEATABILITY', 'error', f'Failed to create diagnostics directory at {diag_dir}: {e}')
				diag_dir = config_dir
			self.reactor.pause(self.reactor.monotonic() + 0.1)

		json_path = os.path.join(diag_dir, f'beacon_repeatability_{timestamp_str}_x{x:.0f}_y{y:.0f}.json')

		try:
			with open(json_path, 'w') as fh:
				fh.write(json_str)
			self.console_echo('BEACON_CHECK_DIRECTIONAL_REPEATABILITY', 'info', f'Results written to {json_path}')
		except Exception as e:
			self.console_echo('BEACON_CHECK_DIRECTIONAL_REPEATABILITY', 'error', f'Failed to write results to {json_path}: {e}')

class BackgroundDisplayStatusProgressHandler:
	def __init__(
			self, 
			printer,
			msg_fmt = "{spinner} {progress:.0f}%",
			display_status_update_interval=0.8,
			spinner_sequence="⠋⠙⠹⠸⠼⠴⠦⠧⠇"):
				
		self.reactor = printer.get_reactor()
		self.gcode = printer.lookup_object('gcode')
		self.display_status = printer.lookup_object('display_status')
		self.display_status_update_interval = display_status_update_interval
		self._spinner_sequence = spinner_sequence
		self._spinner_phase = 0
		self._timer = None
		self._auto_rate_last_eventtime = None
		self.msg_fmt = msg_fmt
		self._progress = 0.0
		self._auto_rate = 0.0

	def enable(self):
		if self._timer:
			return
		
		self._timer = self.reactor.register_timer(
			self._handle_timer, self.reactor.NOW)

	def disable(self):
		if self._timer is None:
			return
		
		self.reactor.unregister_timer(self._timer)
		self._timer = None
		self.display_status.message = None
		self.display_status.progress = None

	@property
	def progress(self):
		return self._progress

	@progress.setter
	def progress(self, value):
		self._progress = min(1.0, max(0.0, value))

	def set_auto_rate(self, increment_per_second):
		"""
		Set the auto rate for the background progress handler.
		This is the amount by which the progress will be automatically incremented per second.
		"""
		self._auto_rate_last_eventtime = None
		self._auto_rate = increment_per_second

	def _handle_timer(self, eventtime):
		if self._auto_rate_last_eventtime is None:
			self._auto_rate_last_eventtime = eventtime

		if self._auto_rate > 0.0:
			self._progress = min(1.0, max(0.0, self._progress + self._auto_rate * (eventtime - self._auto_rate_last_eventtime)))

		self._auto_rate_last_eventtime = eventtime

		spinner = self._spinner_sequence[self._spinner_phase]
		self._spinner_phase = (self._spinner_phase + 1) % len(self._spinner_sequence)

		if self.msg_fmt is not None:
			self.display_status.message = self.msg_fmt.format(progress=self._progress * 100.0, spinner=spinner)
		
		return self.reactor.monotonic() + self.display_status_update_interval

#####
# Loader
#####
def load_config(config):
	return RatOS(config)