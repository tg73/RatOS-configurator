import { Command } from 'commander';
import { Progress } from 'progress-stream';
import { inspectGCode, processGCode } from '@/server/gcode-processor/gcode-processor.ts';
import { echo, fs, tmpfile } from 'zx';
import { ProgressBar, StatusMessage } from '@inkjs/ui';
import { Box, render, Text } from 'ink';
import React from 'react';
import { Container } from '@/cli/components/container.tsx';
import { Duration, DurationLikeObject } from 'luxon';
import path from 'path';
import { z, ZodError } from 'zod';
import { getLogger } from '@/cli/logger.ts';
import { ACTION_ERROR_CODES } from '@/server/gcode-processor/Actions.ts';
import { loadEnvironment } from '@/cli/util.tsx';
import { GCodeError, GCodeProcessorError, SlicerNotSupported } from '@/server/gcode-processor/errors.ts';
import { formatZodError } from '@schema-hub/zod-error-formatter';

const ProgressReportUI: React.FC<{
	report?: Progress;
	done?: boolean;
	error?: string;
	fileName: string;
}> = ({ report, fileName, done, error }) => {
	const eta = report ? report.eta / 60 : 0;
	const percentage = report?.percentage ?? 0;
	const duration = Duration.fromObject({ minutes: report ? report.eta / 60 / 60 : 0 }, { locale: 'en-GB' })
		.normalize()
		.shiftTo(
			...([eta < 1 ? 'seconds' : 'minutes', eta > 60 ? 'hours' : null].filter(Boolean) as (keyof DurationLikeObject)[]),
		)
		.toHuman({ unitDisplay: 'short', listStyle: 'narrow', maximumFractionDigits: 0 });
	return (
		<Container>
			<Text>Processing {fileName}...</Text>
			<Box flexDirection="row" columnGap={1}>
				{report ? (
					<>
						<Text>{percentage.toFixed(2).padStart(6, ' ')}%</Text>
						<Box width={30}>
							<ProgressBar value={report?.percentage ?? 0} />
						</Box>
						<Text>{duration} remaining</Text>
					</>
				) : done ? (
					<StatusMessage variant="success">Done</StatusMessage>
				) : error ? (
					<StatusMessage variant="error">{error}</StatusMessage>
				) : (
					<Text color="gray">Initializing post processor...</Text>
				)}
			</Box>
		</Container>
	);
};

const GcodeInfoZod = z.object({
	generator: z.string(),
	generatorVersion: z.string(),
	flavour: z.number(),
	generatorTimestamp: z.string(),
	ratosDialectVersion: z.string().optional(),
	processedByRatOSVersion: z.string().optional(),
	processedByRatOSTimestamp: z.string().optional(),
});

export const PostProcessorCLIOutput = z
	.object({
		result: z.literal('error'),
		title: z.string().optional(),
		message: z.string(),
	})
	.or(
		z.object({
			result: z.literal('warning'),
			title: z.string().optional(),
			message: z.string(),
		}),
	)
	.or(
		z.object({
			result: z.literal('success'),
			payload: z
				.object({
					extruderTemps: z.array(z.string()).optional(),
					toolChangeCount: z.number(),
					firstMoveX: z.string().optional(),
					firstMoveY: z.string().optional(),
					minX: z.number(),
					maxX: z.number(),
					hasPurgeTower: z.boolean().optional(),
					configSection: z.record(z.string(), z.string()).optional(),
					usedTools: z.array(z.string()),
					gcodeInfo: GcodeInfoZod,
				})
				.or(
					z.object({
						extruderTemps: z.array(z.string()).optional(),
						firstMoveX: z.string().optional(),
						firstMoveY: z.string().optional(),
						hasPurgeTower: z.boolean().optional(),
						configSection: z.record(z.string(), z.string()).optional(),
						wasAlreadyProcessed: z.boolean(),
						gcodeInfo: GcodeInfoZod,
					}),
				),
		}),
	)
	.or(
		z.object({
			result: z.literal('progress'),
			payload: z.object({
				percentage: z.number(),
				eta: z.number(),
			}),
		}),
	);

export type PostProcessorCLIOutput = z.infer<typeof PostProcessorCLIOutput>;

export const toPostProcessorCLIOutput = (obj: PostProcessorCLIOutput): void => {
	try {
		echo(JSON.stringify(PostProcessorCLIOutput.parse(obj)));
	} catch (e) {
		getLogger().error(e, 'An error occurred while serializing postprocessor output');
		if (e instanceof ZodError) {
			getLogger().trace(obj, 'Invalid data passed to toPostProcessorCLIOutput');
			echo(
				JSON.stringify({
					result: 'error',
					title: 'An error occurred while serializing postprocessor output',
					message: `This is likely caused by loading a gcode file that was processed by a legacy version of the RatOS postprocessor.\n\n${formatZodError(e, obj).message}`,
				} satisfies PostProcessorCLIOutput),
			);
		} else {
			throw e;
		}
	}
};

export const postprocessor = (program: Command) => {
	program
		.command('postprocess')
		.description('Postprocess a gcode file for RatOS')
		.option('--non-interactive', 'Output ndjson to stdout instead of rendering a UI')
		.option('-i, --idex', 'Postprocess for an IDEX printer')
		.option('-o, --overwrite', 'Overwrite the output file if it exists')
		.option('-O, --overwrite-input', 'Overwrite the input file')
		.option('-a, --allow-unsupported-slicer-versions', 'Allow unsupported slicer versions')
		.argument('<input>', 'Path to the gcode file to postprocess')
		.argument('[output]', 'Path to the output gcode file (omit for inspection only)')
		.action(async (inputFile, outputFile, args) => {
			// load env variables
			await loadEnvironment();
			let onProgress: ((report: Progress) => void) | undefined = undefined;
			let rerender: ((element: React.ReactNode) => void) | undefined = undefined;
			let lastProgressPercentage: number = -1;
			const isInteractive = process.stdout.isTTY && !args.nonInteractive;
			if (isInteractive) {
				const { rerender: _rerender } = render(<ProgressReportUI fileName={path.basename(inputFile)} />);
				rerender = _rerender;
				onProgress = (report) => {
					_rerender(<ProgressReportUI fileName={path.basename(inputFile)} report={report} />);
				};
			} else {
				onProgress = (report) => {
					const progressTens = Math.floor(report.percentage / 10) * 10;
					if (progressTens > lastProgressPercentage && report.percentage) {
						lastProgressPercentage = progressTens;
						toPostProcessorCLIOutput({
							result: 'progress',
							payload: { percentage: progressTens, eta: isNaN(report.eta) ? 0 : report.eta ?? 0 },
						});
					}
				};
			}

			const opts = {
				idex: args.idex,
				overwrite: args.overwrite || args.overwriteInput,
				allowUnsupportedSlicerVersions: args.allowUnsupportedSlicerVersions,
				onProgress,
				onWarning: (code: string, message: string) => {
					getLogger().trace(code, 'Warning during processing: ' + message);
					switch (code) {
						case ACTION_ERROR_CODES.UNSUPPORTED_SLICER_VERSION:
							toPostProcessorCLIOutput({
								result: 'warning',
								title: 'Unsupported slicer version',
								message: message,
							});
							break;
						case ACTION_ERROR_CODES.HEURISTIC_SMELL:
							toPostProcessorCLIOutput({
								result: 'warning',
								title: 'Unexpected g-code sequence',
								message: message,
							});
							break;
						default:
							toPostProcessorCLIOutput({
								result: 'warning',
								title: 'Unexpected warning',
								message: message,
							});
							getLogger().warn(code, message);
							break;
					}
				},
				// Currently the only warning is about slicer version when allowUnsupportedSlicerVersions is true.
				// Note that unsupported slicer version will throw if onWarning is not provided regardless of allowUnsupportedSlicerVersions.
				// onWarning: (code: string, message: string) => { /* TODO */ },
			};

			try {
				if (args.overwriteInput) {
					outputFile = tmpfile();
				}
				const result = !!outputFile
					? await processGCode(inputFile, outputFile, opts)
					: await inspectGCode(inputFile, { ...opts, fullInspection: false }); // fullInspection default is false, just to demo.

				if (args.overwriteInput) {
					fs.renameSync(outputFile, inputFile);
				}

				if (rerender && isInteractive) {
					rerender(<ProgressReportUI fileName={path.basename(inputFile)} done={true} />);
				} else {
					toPostProcessorCLIOutput({
						result: 'success',
						payload: result,
					});
				}
			} catch (e) {
				let errorMessage =
					'An unexpected error occurred while processing the file, please download a debug-zip and report this issue.';
				let errorTitle = 'An unexpected error occurred during post-processing';
				if (e instanceof GCodeProcessorError) {
					errorTitle = 'G-code could not be processed';
					errorMessage = e.message;
					if (e instanceof SlicerNotSupported) {
						errorTitle = 'Unsupported slicer version';
					}
					if (e instanceof GCodeError && e.lineNumber) {
						errorTitle += ` (line ${e.lineNumber})`;
						errorMessage += `\n\nLine ${e.lineNumber}: ${e.line}`;
					}
				} else if (e instanceof Error) {
					if ('code' in e && e.code === 'ENOENT' && 'path' in e) {
						errorTitle = 'File not found';
						errorMessage = `File ${e.path} not found`;
					} else {
						getLogger().error(e, 'Unexpected error while processing gcode file');
					}
				} else {
					getLogger().error(e, 'Unexpected error while processing gcode file');
				}
				if (rerender && isInteractive) {
					rerender(<ProgressReportUI fileName={path.basename(inputFile)} error={errorMessage} />);
				} else {
					toPostProcessorCLIOutput({
						result: 'error',
						message: errorMessage,
						title: errorTitle,
					});
				}
				process.exit(1);
			}
		});
};
