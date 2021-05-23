// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported initLogging, execCheck, execCommunicate */

const {Gio, GLib} = imports.gi;


// <function>@<file>:<line>:<column>
const _callerMatch = new RegExp(/^([\w]+).*@(.*):(\d+):(\d+)$/);


function _createLogFunction(level = GLib.LogLevelFlags.LEVEL_MESSAGE) {
    return function (message, prefix = null) {
        let caller;

        // @message is an Error
        if (message && message.stack) {
            caller = message.stack.split('\n')[0];
            message = message.message;

        // @message is printable
        } else {
            caller = Error().stack.split('\n')[1];

            if (message && typeof message !== 'string')
                message = JSON.stringify(message, null, 2);
        }

        if (prefix)
            message = `${prefix}: ${message}`;

        const [, func, file, line] = _callerMatch.exec(caller);
        const script = file.split('/').pop();

        GLib.log_structured(pkg.name.split('.').pop(), level, {
            'MESSAGE': `[${script}:${func}:${line}]: ${message}`,
            'SYSLOG_IDENTIFIER': pkg.name,
            'CODE_FILE': file,
            'CODE_FUNC': func,
            'CODE_LINE': line,
        });
    };
}

/**
 * Inject logging functions
 */
function initLogging() {
    const levels = {
        debug: GLib.LogLevelFlags.LEVEL_DEBUG,
        message: GLib.LogLevelFlags.LEVEL_MESSAGE,
        warning: GLib.LogLevelFlags.LEVEL_WARNING,
        critical: GLib.LogLevelFlags.LEVEL_CRITICAL,
    };

    for (const [name, level] of Object.entries(levels)) {
        if (globalThis[name] === undefined)
            globalThis[name] = _createLogFunction(level);
    }

    globalThis.assert = function (expression) {
        if (!expression)
            critical('assertion failure');
    };
}


/**
 * Execute a command asynchronously and check the exit status.
 *
 * If given, @cancellable can be used to stop the process before it finishes.
 *
 * @param {string[]} argv - a list of string arguments
 * @param {Gio.Cancellable} [cancellable] - optional cancellable object
 * @returns {Promise} - The promise for the operation
 */
function execCheck(argv, cancellable = null) {
    let cancelId = 0;

    const proc = new Gio.Subprocess({
        argv: argv,
        flags: Gio.SubprocessFlags.NONE,
    });
    proc.init(cancellable);

    if (cancellable instanceof Gio.Cancellable)
        cancelId = cancellable.connect(() => proc.force_exit());

    return new Promise((resolve, reject) => {
        proc.wait_check_async(null, (_proc, res) => {
            try {
                if (!proc.wait_check_finish(res)) {
                    const status = proc.get_exit_status();

                    throw new Gio.IOErrorEnum({
                        code: Gio.io_error_from_errno(status),
                        message: GLib.strerror(status),
                    });
                }

                resolve();
            } catch (e) {
                reject(e);
            } finally {
                if (cancelId > 0)
                    cancellable.disconnect(cancelId);
            }
        });
    });
}


/**
 * Execute a command asynchronously and return the output from `stdout` on
 * success or throw an error with output from `stderr` on failure.
 *
 * If given, @input will be passed to `stdin` and @cancellable can be used to
 * stop the process before it finishes.
 *
 * @param {string[]} argv - a list of string arguments
 * @param {string} [input] - Input to write to `stdin` or %null to ignore
 * @param {Gio.Cancellable} [cancellable] - optional cancellable object
 * @returns {Promise<string>} - The process output
 */
function execCommunicate(argv, input = null, cancellable = null) {
    let cancelId = 0;
    let flags = Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE;

    if (input !== null)
        flags |= Gio.SubprocessFlags.STDIN_PIPE;

    const proc = new Gio.Subprocess({argv, flags});
    proc.init(cancellable);

    if (cancellable instanceof Gio.Cancellable)
        cancelId = cancellable.connect(() => proc.force_exit());

    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(input, null, (_proc, res) => {
            try {
                const [, stdout, stderr] = proc.communicate_utf8_finish(res);
                const status = proc.get_exit_status();

                if (status !== 0) {
                    throw new Gio.IOErrorEnum({
                        code: Gio.io_error_from_errno(status),
                        message: stderr ? stderr.trim() : GLib.strerror(status),
                    });
                }

                resolve(stdout.trim());
            } catch (e) {
                reject(e);
            } finally {
                if (cancelId > 0)
                    cancellable.disconnect(cancelId);
            }
        });
    });
}

