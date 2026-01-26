

/**
 * 
 * @returns list of relative file paths from printer_data directory
 */
export const upgradeBackupPaths = () => {
    return [
        'database',
        'data',
        'logs',
        'ratos',
        'config',
        'gcodes',
        'systemd',
    ];
}

/**
 * 
 * @returns list of relative file paths from printer_data directory
 */
export const upgradeResetPaths = () => {
    return [
        'database',
        'config/printer.cfg',
        'config/RatOS.cfg',
        'config/ratos-variables.cfg',
        'ratos',
    ];
}

/**
 * @returns list of relative paths from printer_data that should be deleted during upgrade
 */
export const upgradeDeletePaths = () => {
    return [
        'config/klippy_old.cfg',
        'config/mainsail_old.cfg',
    ]
};

