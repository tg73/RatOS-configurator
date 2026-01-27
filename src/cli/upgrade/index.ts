import { Signal } from '@/app/_helpers/signal';
import { echo, Shell } from 'zx';
import { loadEnvironment } from '@/cli/util';
export interface UpgradeProcedureOptions {
    cmdSignal: Signal<string | null>;
    shell: Shell;
    branch: string;
    fork?: string;
    dryRun?: boolean;
}

export interface UpgradeInfo {
    status: 'running' | 'success' | 'error';
    begin: () => Promise<void>;
}



export const UpgradeProcedure =  (options: UpgradeProcedureOptions): UpgradeInfo => {
    const status = 'running'
    const { shell: $$, cmdSignal, branch, fork, dryRun } = options;
    const steps = [];

    const {NODE_ENV} = loadEnvironment();

    const begin = async () => {
        echo(`Starting upgrade to branch ${branch} ${fork ? `from fork ${fork}` : ''}`);
        // stop services
        if (dryRun || NODE_ENV === 'development') {
            echo('services to be stoped: ratos-configurator, klipper, moonraker');
        } else {
            $$`sudo systemctl stop ratos-configurator`;
            $$`sudo systemctl stop klipper`;
            $$`sudo systemctl stop moonraker`;
        }

        // backup existing installation
        
        // reset files
        // switch branch
        // restart services
    }
    return { status, begin }
};
