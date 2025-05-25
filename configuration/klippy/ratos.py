import os, logging, glob, traceback, inspect, re, math
import json, subprocess, pathlib, time
import numpy as np
from . import probe
import multiprocessing

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

		# Status fields
		self.last_processed_file_result = None
		self.last_check_bed_mesh_profile_exists_result = None

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

		if self.config.has_section("dual_carriage"):
			self.dual_carriage = self.printer.lookup_object("dual_carriage", None)
		if self.config.has_section("rmmu_hub"):
			self.rmmu_hub = self.printer.lookup_object("rmmu_hub", None)
		if self.config.has_section("bed_mesh"):
			self.bed_mesh = self.printer.lookup_object('bed_mesh')

		# Register overrides.
		self.register_command_overrides()

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
		self.gcode.register_command('HELLO_RATOS', self.cmd_HELLO_RATOS, desc=(self.desc_HELLO_RATOS))
		self.gcode.register_command('CACHE_IS_GRAPH_FILES', self.cmd_CACHE_IS_GRAPH_FILES, desc=(self.desc_CACHE_IS_GRAPH_FILES))
		self.gcode.register_command('SHOW_IS_GRAPH_FILES', self.cmd_SHOW_IS_GRAPH_FILES, desc=(self.desc_SHOW_IS_GRAPH_FILES))
		self.gcode.register_command('CONSOLE_ECHO', self.cmd_CONSOLE_ECHO, desc=(self.desc_CONSOLE_ECHO))
		self.gcode.register_command('RATOS_LOG', self.cmd_RATOS_LOG, desc=(self.desc_RATOS_LOG))
		self.gcode.register_command('PROCESS_GCODE_FILE', self.cmd_PROCESS_GCODE_FILE, desc=(self.desc_PROCESS_GCODE_FILE))
		self.gcode.register_command('ALLOW_UNKNOWN_GCODE_GENERATOR', self.cmd_ALLOW_UNKNOWN_GCODE_GENERATOR, desc=(self.desc_ALLOW_UNKNOWN_GCODE_GENERATOR))
		self.gcode.register_command('BYPASS_GCODE_PROCESSING', self.cmd_BYPASS_GCODE_PROCESSING, desc=(self.desc_BYPASS_GCODE_PROCESSING))
		self.gcode.register_command('_SYNC_GCODE_POSITION', self.cmd_SYNC_GCODE_POSITION, desc=(self.desc_SYNC_GCODE_POSITION))
		self.gcode.register_command('_CHECK_BED_MESH_PROFILE_EXISTS', self.cmd_CHECK_BED_MESH_PROFILE_EXISTS, desc=(self.desc_CHECK_BED_MESH_PROFILE_EXISTS))
		self.gcode.register_command('_RAISE_ERROR', self.cmd_RAISE_ERROR, desc=(self.desc_RAISE_ERROR))
		self.gcode.register_command('_TRY', self.cmd_TRY, desc=(self.desc_TRY))
		self.gcode.register_command('_DEBUG_ECHO_STACK_TRACE', self.cmd_DEBUG_ECHO_STACK_TRACE, desc=(self.desc_DEBUG_ECHO_STACK_TRACE))
		self.gcode.register_command('MULTI_POINT_PROBE', self.cmd_MULTI_POINT_PROBE, desc=(self.desc_MULTI_POINT_PROBE))

	def register_command_overrides(self):
		self.register_override('TEST_RESONANCES', self.override_TEST_RESONANCES, desc=(self.desc_TEST_RESONANCES))
		self.register_override('SHAPER_CALIBRATE', self.override_SHAPER_CALIBRATE, desc=(self.desc_SHAPER_CALIBRATE))

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
				return False;

			if process.returncode != 0:
				# We should've already printed the error message in _interpret_output
				error = process.stderr.read().decode().strip()
				if error:
					logging.error(error)

				self.post_process_success = False
				return False;

			return self.post_process_success;

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

		if (type == 'error' or type == 'alert'):
			logging.error(title + ": " + msg.replace("_N_","\n"))
		if (type == 'warning'):
			logging.warning(title + ": " + msg.replace("_N_","\n"))

		_title = '<p style="font-weight: bold; margin:0; opacity:' + str(opacity) + '; color:' + color + '">' + title + '</p>'
		if msg:
			_msg = '<p style="margin:0; opacity:' + str(opacity) + '; color:' + color + '">' + msg.replace("_N_","\n") + '</p>'
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
	
	def get_status(self, eventtime):
		return {
			'name': self.name,
			'last_processed_file_result': self.last_processed_file_result,
			'last_check_bed_mesh_profile_exists_result': self.last_check_bed_mesh_profile_exists_result }

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
	
	#####
	# Multi-point Probe
	#####

	@staticmethod
	def pack_circles_concentric(radius, x_offset = 0., y_offset = 0., rings = 3, include_centre = True):
		"""
		Pack circles (radius r) using a concentric rings approach.

		Parameters:
		- radius: radius of circles
		- rings: number of rings, including the single central circle as the first ring.
		  With the centre circle included, 2 rings produces 7 circles, 3 rings 19,
		  4 rings 37, 5 rings 61.
		- include_centre: include the central circule in the result. Does not change
		  the meaning of the `rings` argument.
		
		Returns:
			centres: a list of (x, y) coordinates for the centres of the packed circles.
		"""
		centres = []
		
		# Place the center circle if it fits
		if include_centre and rings > 0:
			centres.append((x_offset, y_offset))
		
		ring = 1
		# For each ring, compute the ring radius as d = ring * 2r.
		# (This is a simple choice; more refined methods can use non-uniform ring spacing)
		while ring < rings:
			d = ring * 2 * radius  # distance from center for current ring

			# Maximum circles that fit in this ring (angle between centers at least 2r/d)
			n_circles = int(np.floor(2 * np.pi * d / (2 * radius)))
			
			# Place circles evenly around the ring
			for i in range(n_circles):
				theta = 2 * np.pi * i / n_circles
				x = d * np.cos(theta)
				y = d * np.sin(theta)
				centres.append((float(x + x_offset), float(y + y_offset)))
			ring += 1
			
		return centres
	
	@staticmethod
	def random_point_in_circle(radius, center_x, center_y):
		# Generate a random angle between 0 and 2π
		theta = np.random.uniform(0, 2 * np.pi)

		# Generate a random distance, ensuring uniform distribution within the circle
		r = radius * np.sqrt(np.random.uniform(0, 1))

		# Convert polar coordinates to Cartesian coordinates
		x = center_x + r * np.cos(theta)
		y = center_y + r * np.sin(theta)

		return x, y	
	
	@staticmethod
	def random_point_on_circle(radius, center_x, center_y):
		# Generate a random angle in radians
		theta = np.random.uniform(0, 2 * np.pi)

		# Compute the x and y coordinates
		x = center_x + radius * np.cos(theta)
		y = center_y + radius * np.sin(theta)

		return float(x), float(y)

	@staticmethod	
	def circle_points(n, radius, center_x, center_y):
		"""Generate 'n' evenly spaced points on a circle of given radius centered at (center_x, center_y)."""
		angles = np.linspace(0, 2 * np.pi, n, endpoint=False)
		x_points = center_x + radius * np.cos(angles)
		y_points = center_y + radius * np.sin(angles)
		return np.column_stack((x_points, y_points)).tolist()

	def _generate_points(self, n, x_lim, y_lim, min_dist, max_iter=10000):
		"""
		Generate n random points within given x and y limits such that
		any two points are at least min_dist apart.
		
		Parameters:
		- n: number of points to generate
		- x_lim: tuple (min_x, max_x)
		- y_lim: tuple (min_y, max_y)
		- min_dist: minimum required Euclidean distance between any two points
		- max_iter: maximum number of iterations to try (to avoid infinite loops)
		
		Returns:
		- A NumPy array of shape (m, 2) of the generated points, where m <= n.
		"""
		points = []
		iterations = 0

		while len(points) < n and iterations < max_iter:
			# Generate a candidate point uniformly within the given x and y limits.
			candidate = np.array([np.random.uniform(x_lim[0], x_lim[1]),
								np.random.uniform(y_lim[0], y_lim[1])])
			
			# Check that candidate is at least min_dist away from every existing point.
			if all(np.linalg.norm(candidate - p) >= min_dist for p in points):
				points.append(candidate.tolist()) # don't leak numpy types
			
			iterations += 1
		
		if len(points) < n:
			raise self.gcode.error(
				"Could not generate all required probe points within the specified iteration limit. "
				"The conditions are too strict.")
		
		return points
	
	def _check_homed(self, msg = 'Must home first'):
		status = self.toolhead.get_status(self.reactor.monotonic())
		homed_axes = status["homed_axes"]
		if any(axis not in homed_axes for axis in "xyz"):
			raise self.gcode.error( msg )
				
	desc_MULTI_POINT_PROBE = "TO DO"
	def cmd_MULTI_POINT_PROBE(self, gcmd):
		
		self._check_homed()

		# - assumes already at desired centre location
		# cmd COUNT=5 MIN_SPAN=10 [SAMPLES=1 SAMPLES_DROP=0 PROBE_METHOD=contact]
		pattern = gcmd.get('PATTERN', 'random').strip().lower()
		if pattern not in ('random', 'concentric', 'circle'):
			raise gcmd.error('If specified, PATTERN must be random, concentric or circle')

		extruder_name = 'extruder'
		
		if self.dual_carriage and self.dual_carriage.dc[1].mode.lower() == 'primary':
			extruder_name = 'extruder1'
		
		extruder = self.printer.lookup_object(extruder_name)
		nozzle_diameter = extruder.nozzle_diameter
		
		# Based on V6 standard, total nozzle tip diameter is typically 2.5 times hole diameter (spec'd up to 0.8mm),
		# except below 0.25mm where it's 1.5 times hole diameter. FIN specifies 2.0 times hole diameter.
		# Slice GammaMaster 2.4mm nozzle has ~3.75mm tip (from their published STEP model), a multiplier
		# of 1.56, or an increase of 1.35. Here we make some effort at a reasonable approximation.
		if nozzle_diameter < 0.25:
			nozzle_tip_dia = 1.5 * nozzle_diameter
		elif nozzle_diameter <= 0.8:
			nozzle_tip_dia = 2.5 * nozzle_diameter
		else:
			nozzle_tip_dia = nozzle_diameter + 1.35
		
		pos = self.toolhead.get_position()

		printable_x = ( self.gm_ratos.variables.get('printable_x_min'),	self.gm_ratos.variables.get('printable_x_max') )
		printable_y = ( self.gm_ratos.variables.get('printable_y_min'),	self.gm_ratos.variables.get('printable_y_max') )

		def includes( r, value ):
			return r[0] <= value <= r[1]

		if pattern == 'random':		
			count = gcmd.get_int('COUNT', 5)
			min_span = gcmd.get_float('MIN_SPAN', 10.)

			# Calculate the nozzle-based min range as the length of the side of a
			# square with area four times the footprint of COUNT nozzle tips.
			nozzle_based_min_span = math.sqrt(math.pi * (nozzle_tip_dia/2)**2 * count * 4.)
			span = max(min_span, nozzle_based_min_span)
			half_span = span / 2.

			gcmd.respond_info(f"count: {count}  min_span: {min_span}  extruder: {extruder.name}  nozzle_dia: {nozzle_diameter:.3f}  nozzle_tip_dia: {nozzle_tip_dia:.3f}  nozzle_based_min_range: {nozzle_based_min_span:.2f}  use_range: {span:.2f}")
			self.mpp_save_meta = dict(pattern=0,count=count, min_span=min_span, nozzle_diameter=nozzle_diameter, nozzle_tip_dia=nozzle_tip_dia, nozzle_based_min_span=nozzle_based_min_span, span=span)
			self.mpp_filename_suffix = f"-random{count}"

			range_x = (pos[0] - half_span, pos[0] + half_span)
			range_y = (pos[1] - half_span, pos[1] + half_span)
			
			if not (
				includes(printable_x, range_x[0]) and includes(printable_x, range_x[1]) and 
				includes(printable_y, range_y[0]) and includes(printable_y, range_y[1])):
				self.console_echo('MULTI_POINT_PROBE', 'error', f'The required span ({span:.1f}) would probe outside the printable area.')
				raise gcmd.error('The required span would probe outside the printable area')
			
			points = self._generate_points(count, range_x, range_y, nozzle_tip_dia)
		elif pattern == 'concentric':
			rings = gcmd.get_int('RINGS', 3, minval=2, maxval=4)
			include_centre = gcmd.get_int('INCLUDE_CENTRE', 0) == 1
			jitter_tip_dia_factor = gcmd.get_float('JITTER', 3., minval=0., maxval=50.)

			span = ((((rings * 2) - 1 ) * nozzle_tip_dia)/2) + ( jitter_tip_dia_factor * nozzle_tip_dia )
			
			cx, cy = self.random_point_in_circle(jitter_tip_dia_factor * nozzle_tip_dia / 2, pos[0], pos[1])

			gcmd.respond_info(f"rings: {rings}  include_centre: {include_centre}  jitter: {jitter_tip_dia_factor:.1f}  extruder: {extruder.name}  nozzle_dia: {nozzle_diameter:.3f}  nozzle_tip_dia: {nozzle_tip_dia:.3f}  span: {span:.2f}  c: {cx:.2f}, {cy:.2f}")
			self.mpp_filename_suffix = f"-concentric-r{rings}-ic{'1' if include_centre else '0'}-j{jitter_tip_dia_factor:.1f}"
			self.mpp_save_meta = dict(pattern=1,rings=rings,include_centre=include_centre,jitter=jitter_tip_dia_factor,nozzle_diameter=nozzle_diameter, nozzle_tip_dia=nozzle_tip_dia,span=span,centre=(cx,cy))

			range_x = (pos[0] - span, pos[0] + span)
			range_y = (pos[1] - span, pos[1] + span)

			if not (
				includes(printable_x, range_x[0]) and includes(printable_x, range_x[1]) and 
				includes(printable_y, range_y[0]) and includes(printable_y, range_y[1])):
				self.console_echo('MULTI_POINT_PROBE', 'error', f'The required span ({span:.1f}) would probe outside the printable area.')
				raise gcmd.error('The required span would probe outside the printable area')
			
			points = self.pack_circles_concentric(nozzle_tip_dia/2, cx, cy, rings, include_centre)
		elif pattern == 'circle':
			dia = gcmd.get_float('DIA', 10.0)
			count = gcmd.get_int('COUNT', 60)

			span = dia + nozzle_diameter
			cx = pos[0]
			cy = pos[1]
			
			gcmd.respond_info(f"dia: {dia}  count: {count}  extruder: {extruder.name}  nozzle_dia: {nozzle_diameter:.3f}  nozzle_tip_dia: {nozzle_tip_dia:.3f}  span: {span:.2f}  c: {cx:.2f}, {cy:.2f}")
			self.mpp_filename_suffix = f"-circle-{dia:.1f}d{count}"
			self.mpp_save_meta = dict(pattern=2,count=count,dia=dia,nozzle_diameter=nozzle_diameter, nozzle_tip_dia=nozzle_tip_dia,span=span,centre=(cx,cy))

			range_x = (pos[0] - span, pos[0] + span)
			range_y = (pos[1] - span, pos[1] + span)

			if not (
				includes(printable_x, range_x[0]) and includes(printable_x, range_x[1]) and 
				includes(printable_y, range_y[0]) and includes(printable_y, range_y[1])):
				self.console_echo('MULTI_POINT_PROBE', 'error', f'The required span ({span:.1f}) would probe outside the printable area.')
				raise gcmd.error('The required span would probe outside the printable area')
			
			points = self.circle_points(count, dia/2, cx, cy)
		else:
			raise gcmd.error(f"Pattern '{pattern}' not implemented.")
		
		#gcmd.respond_info( "\n".join([f"{p[0]:.2f}, {p[1]:.2f}" for p in points]))
		
		# TODO: ProbePointsHelper will consider name, horizontal_move_z and speed from config. It's weird to conflate those
		# values with [ratos] config. It would seem cleaner to move MULTI_POINT_PROBE into its own file.
		probe_helper = probe.ProbePointsHelper(self.config, self.probe_finalize, [])
		probe_helper.update_probe_points(points, len(points))
		probe_helper.start_probe(gcmd)

	def probe_finalize(self, offsets, positions):
		def percentile_filter(data, margin=5.):
			lower_bound = np.percentile(data, margin)
			upper_bound = np.percentile(data, 100. - margin)
			filtered_data = data[np.logical_and(data >= lower_bound, data <= upper_bound)]  # Safe comparison
			return filtered_data

		#self.gcode.respond_info(f"offsets:\n{offsets}")
		#self.gcode.respond_info(f"positions:\n{positions}")
		z = np.array([p[2] for p in positions])
		self.gcode.respond_info(f"mean: {np.mean(z):.5f}  median: {np.median(z):.5f} min: {np.min(z):.5f}  max: {np.max(z):.5f}  spread: {np.max(z)-np.min(z):.5f}  sd: {np.std(z):.5f}")
		#z5 = percentile_filter(z, 5.)
		#self.gcode.respond_info(f"mean5: {np.mean(z5):.5f}  median5: {np.median(z5):.5f}")

		#fn = f"/tmp/multi-point-probe{self.mpp_filename_suffix}.csv"
		#with open(fn, "a") as f:
		#	f.write(",".join([str(v) for v in z]))
		#	f.write("\n")

		self.append_to_mpp_file(positions, offsets)
		return 'done'
	
	def append_to_mpp_file(self, positions, offsets):
		parent_conn, child_conn = multiprocessing.Pipe()

		def do():
			try:
				child_conn.send(
					(False, self._do_append_to_mpp_file(positions, offsets, self.mpp_save_meta, self.mpp_filename_suffix))
				)
			except Exception:
				child_conn.send((True, traceback.format_exc()))
			child_conn.close()

		child = multiprocessing.Process(target=do)
		child.daemon = True
		child.start()
		reactor = self.reactor
		eventtime = reactor.monotonic()
		while child.is_alive():
			eventtime = reactor.pause(eventtime + 0.1)
		is_err, result = parent_conn.recv()
		child.join()
		parent_conn.close()
		if is_err:
			raise Exception("Error appending data to npz file: %s" % (result,))
		else:
			is_inner_err, inner_result = result
			if is_inner_err:
				raise self.gcode.error(inner_result)
			else:
				return inner_result

	@staticmethod
	def _do_append_to_mpp_file(positions, offsets, meta, filename_suffix):		
		def get_save_map(i):
			return { 
				f'positions_{i}': positions, 
				f'offsets_{i}': offsets
			} | {f'{k}_{i}': np.asanyarray(v) for k,v in meta.items()}
			
		fn = f"/tmp/multi-point-probe{filename_suffix}.npz"
		if os.path.exists(fn):
			with np.load(fn) as npz:
				count = int(npz['count'])
				np.savez_compressed( fn, count=np.array(count+1), **{k:v for k,v in npz.items() if k != 'count'}, **get_save_map(count) )
		else:
			np.savez_compressed( fn, count=np.array(1), **get_save_map(0) )
		return (False, None)

#####
# Loader
#####
def load_config(config):
	return RatOS(config)