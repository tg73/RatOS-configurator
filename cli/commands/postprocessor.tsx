import { Command } from 'commander';
import { Progress } from 'progress-stream';
import { inspectGCode, processGCode } from '@/server/gcode-processor/gcode-processor.ts';
import { echo } from 'zx';
import { ProgressBar, StatusMessage } from '@inkjs/ui';
import { Box, render, Text } from 'ink';
import React from 'react';
import { Container } from '@/cli/components/container.tsx';
import { Duration, DurationLikeObject } from 'luxon';
import path from 'path';
import { z } from 'zod';

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

export const PostProcessorCLIOutput = z
	.object({
		result: z.literal('error'),
		error: z.string(),
	})
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
					gcodeInfo: z.object({
						generator: z.string(),
						generatorVersion: z.string(),
						flavour: z.number(),
						generatorTimestamp: z.string(),
						ratosDialectVersion: z.string().optional(),
						processedByRatOSVersion: z.string().optional(),
						processedByRatOSTimestamp: z.string().optional(),
					}),
				})
				.or(
					z.object({
						wasAlreadyProcessed: z.boolean(),
						gcodeInfo: z.object({
							generator: z.string(),
							generatorVersion: z.string(),
							flavour: z.number(),
							generatorTimestamp: z.string(),
							ratosDialectVersion: z.string().optional(),
							processedByRatOSVersion: z.string().optional(),
							processedByRatOSTimestamp: z.string().optional(),
						}),
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
		echo(JSON.stringify({ result: 'error', error: `${e}` } satisfies PostProcessorCLIOutput));
	}
};

export const postprocessor = (program: Command) => {
	program
		.command('postprocess')
		.description('Postprocess a gcode file for RatOS')
		.option('-r, --rmmu', 'Postprocess for a printer with an RMMU')
		.option('--non-interactive', 'Output ndjson to stdout instead of rendering a UI')
		.option('-i, --idex', 'Postprocess for an IDEX printer')
		.option('-o, --overwrite', 'Overwrite the output file if it exists')
		.argument('<input>', 'Path to the gcode file to postprocess')
		.argument('[output]', 'Path to the output gcode file (omit for inspection only)')
		.action(async (inputFile, outputFile, args) => {
			let onProgress: ((report: Progress) => void) | undefined = undefined;
			let rerender: ((element: React.ReactNode) => void) | undefined = undefined;
			let lastProgressPercentage: number = 0;
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
					if (progressTens > lastProgressPercentage && report.percentage > 10) {
						lastProgressPercentage = progressTens;
						toPostProcessorCLIOutput({ result: 'progress', payload: { percentage: progressTens, eta: report.eta } });
					}
				};
			}

			const opts = {
				idex: args.idex,
				rmmu: args.rmmu,
				overwrite: args.overwrite,
				onProgress,
				// Currently the only warning is about slicer version when allowUnsupportedSlicerVersions is true.
				// Note that unsupported slicer version will throw if onWarning is not provided regardless of allowUnsupportedSlicerVersions.
				// onWarning: (code: string, message: string) => { /* TODO */ },
			};

			try {
				const result = !!outputFile
					? await processGCode(inputFile, outputFile, opts)
					: await inspectGCode(inputFile, { ...opts, fullInspection: false }); // fullInspection default is false, just to demo.

				if (rerender && isInteractive) {
					rerender(<ProgressReportUI fileName={path.basename(inputFile)} done={true} />);
				} else {
					toPostProcessorCLIOutput({
						result: 'success',
						payload: result,
					});
				}
			} catch (e) {
				let errorMessage = '';
				if (e instanceof Error) {
					if ('code' in e && e.code === 'ENOENT' && 'path' in e) {
						errorMessage = `File ${e.path} not found`;
					} else {
						errorMessage = e.message;
					}
				} else {
					errorMessage = `${e}`;
				}
				if (rerender && isInteractive) {
					rerender(<ProgressReportUI fileName={path.basename(inputFile)} error={errorMessage} />);
				} else {
					toPostProcessorCLIOutput({ result: 'error', error: errorMessage });
				}
			}
		});
};
