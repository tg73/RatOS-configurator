import { Signal } from '@/app/_helpers/signal';
import exp from 'constants';
import { BellRingIcon } from 'lucide-react';
import { identity } from 'rxjs';
import { runAfterFramePaint } from 'scichart';
import { ProcessOutput, Shell } from 'zx';

export interface UpgradeProcedureOptions {
    cmdSignal: Signal<string | null>;
    shell: Shell;
    branch: string;
    fork?: string;
}

export interface UpgradeInfo {
    status: 'running' | 'success' | 'error';
    begin: () => Promise<void>;
}



export const UpgradeProcedure =  (options: UpgradeProcedureOptions): UpgradeInfo => {
    const status = 'running'
    const { shell: $$, cmdSignal, branch, fork } = options;
    const steps = [];

    const begin = async () => {
        // backup existing installation
        // stop services
        // reset files
        // switch branch
        // restart services
    }
    return { status, begin }
};
