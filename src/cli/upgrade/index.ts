import { Signal } from '@/app/_helpers/signal';
import exp from 'constants';
import { BellRingIcon } from 'lucide-react';
import { identity } from 'rxjs';
import { ProcessOutput, Shell } from 'zx';

export interface UpgradeProcedureOptions {
    cmdSignal: Signal<string | null>;
    shell: Shell;
    branch: string;
    fork?: string;
}

export interface UpgradeInfo {
    steps: UpgradeStep[];
    begin: () => Promise<void>;
}

export type ProcedureStatus = 'pending' | 'running' | 'success' | 'error';

export interface UpgradeStep {
    id: string;
    name: string;
    description: string;
    status: ProcedureStatus;
    procedure: () => Promise<ProcessOutput>;
}

export interface StepProcedureOptions {
    id: string;
    name: string;
    description: string;
    procedure: () => Promise<ProcessOutput>;
}

export const UpgradeProcedure =  (options: UpgradeProcedureOptions): UpgradeInfo => {
    const { shell: $$, cmdSignal, branch, fork } = options;
    const steps: UpgradeStep[] = [];

    const backupFiles = upgradeProcedureStep(options,{
        id: 'backup-files',
        name: 'Backing up files',
        description: 'Creating a backup of your important RatOS files', 
        procedure: async () => {
            return await $$`echo ${'Backing up files'}`;
        }
    });
    const begin = async () => {
        for (const step of steps) {
            step.status = 'running';
            cmdSignal.set(`Starting: ${step.name}`);
            try {
                await step.procedure();
                step.status = 'success';
                cmdSignal.set(`Completed: ${step.name}`);
            } catch (error) {
                step.status = 'error';
                cmdSignal.set(`Error during: ${step.name}`);
                break;
            }
        }
    }
    return { steps, begin }
};

function upgradeProcedureStep( procedureOptions: UpgradeProcedureOptions, stepProcedureOptions: StepProcedureOptions ) {
    let $$ = procedureOptions.shell;
    let status: ProcedureStatus = 'pending';
    return {
        id: 'upgrade-process',
        name: 'Upgrading RatOS',
        description: 'Downloading and installing the latest RatOS version',
        status,
        procedure: async () => {
            return await $$`echo ${'Upgrading RatOS'}`;
        },
    }
}