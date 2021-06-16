// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported initLogging, Exec, File, Log */

const ByteArray = imports.byteArray;
const {Gio, GLib} = imports.gi;


// <function>@<file>:<line>:<column>
const _callerMatch = new RegExp(/^([\w]+).*@(.*):(\d+):(\d+)$/);


function _createLogFunction(level = GLib.LogLevelFlags.LEVEL_MESSAGE) {
    const domain = pkg.name.split('.').pop();
    const syslogIdentifier = pkg.name;

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

        GLib.log_structured(domain, level, {
            'MESSAGE': `[${script}:${func}:${line}]: ${message}`,
            'SYSLOG_IDENTIFIER': syslogIdentifier,
            'CODE_FILE': file,
            'CODE_FUNC': func,
            'CODE_LINE': line,
        });
    };
}

/**
 * A collection of logging utilities.
 */
var Log = {
    /**
     * Log an error or message at `G_LOG_LEVEL_DEBUG`.
     *
     * @param {Error|string} [message] - Optional Error or String
     * @param {string} [prefix] - Optional prefix
     */
    debug: _createLogFunction(GLib.LogLevelFlags.LEVEL_DEBUG),

    /**
     * Log an error or message at `G_LOG_LEVEL_MESSAGE`.
     *
     * @param {Error|string} [message] - Optional Error or String
     * @param {string} [prefix] - Optional prefix
     */
    message: _createLogFunction(GLib.LogLevelFlags.LEVEL_MESSAGE),

    /**
     * Log an error or message at `G_LOG_LEVEL_WARNING`.
     *
     * @param {Error|string} [message] - Optional Error or String
     * @param {string} [prefix] - Optional prefix
     */
    warning: _createLogFunction(GLib.LogLevelFlags.LEVEL_WARNING),

    /**
     * Log an error or message at `G_LOG_LEVEL_CRITICAL`.
     *
     * @param {Error|string} [message] - Optional Error or String
     * @param {string} [prefix] - Optional prefix
     */
    critical: _createLogFunction(GLib.LogLevelFlags.LEVEL_CRITICAL),

    /**
     * Log a critical warning if @condition evaluates to false
     *
     * @param {*} [condition] - Optional expression or value
     * @param {string} [message] - Optional message
     */
    assert: function (condition = false, message = null) {
        if (!condition)
            Log.critical(message || 'assertion failure');
    },
};

/**
 * Inject logging functions for debug, message, warning and critical onto
 * `globalThis`.
 */
function initLogging() {
    // Be careful not to trample anything
    for (const [name, func] of Object.entries(Log)) {
        if (globalThis[name] === undefined)
            globalThis[name] = func;
    }
}


/**
 * A collection of process utilities.
 */
var Exec = {
    /**
     * Execute @argv asynchronously and check the exit status.
     *
     * @param {string[]} argv - a list of string arguments
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @returns {Promise} - The promise for the operation
     */
    check: function (argv, cancellable = null) {
        const proc = new Gio.Subprocess({
            argv: argv,
            flags: Gio.SubprocessFlags.STDOUT_SILENCE |
                Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc.init(cancellable);

        let cancelId = 0;

        if (cancellable instanceof Gio.Cancellable)
            cancelId = cancellable.connect(() => proc.force_exit());

        return new Promise((resolve, reject) => {
            proc.wait_check_async(null, (_proc, res) => {
                try {
                    if (!_proc.wait_check_finish(res)) {
                        const status = _proc.get_exit_status();

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
    },

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
    communicate: function (argv, input = null, cancellable = null) {
        let flags = Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_PIPE;

        if (input !== null)
            flags |= Gio.SubprocessFlags.STDIN_PIPE;

        const proc = new Gio.Subprocess({argv, flags});
        proc.init(cancellable);

        let cancelId = 0;

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
    },
};

/**
 * A collection of file utilities.
 */
var File = {
    /**
     * Copy @src to @dest.
     *
     * @param {Gio.File|string} src - the file to copy
     * @param {Gio.File|string} dest - the destination
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise} a Promise for the operation
     */
    copy: function (src, dest, cancellable = null) {
        if (typeof src === 'string')
            src = Gio.File.new_for_path(src);

        if (typeof dest === 'string')
            dest = Gio.File.new_for_path(dest);

        return new Promise((resolve, reject) => {
            src.copy_async(
                dest,
                Gio.FileCopyFlags.NOFOLLOW_SYMLINKS |
                    Gio.FileCopyFlags.OVERWRITE,
                GLib.PRIORITY_DEFAULT,
                null,
                cancellable,
                (file, res) => {
                    try {
                        resolve(file.copy_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    },

    /**
     * Copy @src recursively to @dest.
     *
     * @param {Gio.File|string} src - the source file or directory to move
     * @param {Gio.File|string} dest - the destination directory
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     */
    recursiveCopy: async function (src, dest, cancellable = null) {
        if (typeof src === 'string')
            src = Gio.File.new_for_path(src);

        if (typeof dest === 'string')
            dest = Gio.File.new_for_path(dest);

        if (!dest.query_exists(cancellable))
            dest.make_directory_with_parents(cancellable);

        const iter = await new Promise((resolve, reject) => {
            src.enumerate_children_async(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (file, res) => {
                    try {
                        resolve(file.enumerate_children_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        // We'll collect all the branches and copy them in parallel
        const branches = [];

        while (true) {
            const infos = await new Promise((resolve, reject) => {
                iter.next_files_async(
                    10, // max results
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (_iter, res) => {
                        try {
                            resolve(_iter.next_files_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });

            if (infos.length === 0)
                break;

            for (const info of infos) {
                const child = src.get_child(info.get_name());
                const destChild = dest.get_child(info.get_name());

                let branch;

                switch (info.get_file_type()) {
                    case Gio.FileType.REGULAR:
                    case Gio.FileType.SYMBOLIC_LINK:
                        branch = this.copy(child, destChild, cancellable);
                        break;

                    case Gio.FileType.DIRECTORY:
                        branch = this.recursiveCopy(child, destChild,
                            cancellable);
                        break;

                    default:
                        continue;
                }

                branches.push(branch);
            }
        }

        return Promise.all(branches);
    },

    /**
     * Delete @file which must be a regular file.
     *
     * @param {Gio.File|string} file - the file to delete
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise} a Promise for the operation
     */
    delete: function (file, cancellable = null) {
        if (typeof file === 'string')
            file = Gio.File.new_for_path(file);

        return new Promise((resolve, reject) => {
            file.delete_async(
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (_file, res) => {
                    try {
                        resolve(_file.delete_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    },

    /**
     * Recursively delete @file and any children it may have.
     *
     * @param {Gio.File|string} file - the file or directory to delete
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise} a Promise for the operation
     */
    recursiveDelete: async function (file, cancellable = null) {
        if (typeof file === 'string')
            file = Gio.File.new_for_path(file);

        try {
            const iter = await new Promise((resolve, reject) => {
                file.enumerate_children_async(
                    'standard::type',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (_file, res) => {
                        try {
                            resolve(_file.enumerate_children_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });

            // We'll collect all the branches and delete them in parallel
            const branches = [];

            while (true) {
                const infos = await new Promise((resolve, reject) => {
                    iter.next_files_async(
                        10, // numfiles
                        GLib.PRIORITY_DEFAULT,
                        cancellable,
                        (_iter, res) => {
                            try {
                                resolve(_iter.next_files_finish(res));
                            } catch (e) {
                                reject(e);
                            }
                        }
                    );
                });

                if (infos.length === 0)
                    break;

                for (const info of infos) {
                    const child = iter.get_child(info);
                    const type = info.get_file_type();

                    let branch;

                    switch (info.get_file_type()) {
                        case Gio.FileType.REGULAR:
                        case Gio.FileType.SYMBOLIC_LINK:
                            branch = this.delete(child, cancellable);
                            break;

                        case Gio.FileType.DIRECTORY:
                            branch = this.recursiveDelete(child, cancellable);
                            break;

                        default:
                            continue;
                    }

                    branches.push(branch);
                }
            }

            await Promise.all(branches);
            await this.delete(file, cancellable);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) &&
                !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_DIRECTORY))
                throw e;
        }
    },

    /**
     * Move @src to @dest.
     *
     * @param {Gio.File|string} src - the source file or directory to move
     * @param {Gio.File|string} dest - the destination directory
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     */
    move: function (src, dest, cancellable = null) {
        return src.move(dest, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS |
            Gio.FileCopyFlags.OVERWRITE, cancellable, null);
    },

    /**
     * Move @src recursively to @dest.
     *
     * @param {Gio.File|string} src - the source file or directory to move
     * @param {Gio.File|string} dest - the destination directory
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     */
    recursiveMove: async function (src, dest, cancellable = null) {
        if (typeof src === 'string')
            src = Gio.File.new_for_path(src);

        if (typeof dest === 'string')
            dest = Gio.File.new_for_path(dest);

        if (!dest.query_exists(cancellable))
            dest.make_directory_with_parents(cancellable);

        const iter = await new Promise((resolve, reject) => {
            src.enumerate_children_async(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (file, res) => {
                    try {
                        resolve(file.enumerate_children_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        // Collect all the branches and move them in parallel
        const branches = [];

        while (true) {
            const infos = await new Promise((resolve, reject) => {
                iter.next_files_async(
                    10, // max results
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (_iter, res) => {
                        try {
                            resolve(_iter.next_files_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });

            if (infos.length === 0)
                break;

            for (const info of infos) {
                const child = src.get_child(info.get_name());
                const destChild = dest.get_child(info.get_name());

                let branch;

                switch (info.get_file_type()) {
                    case Gio.FileType.REGULAR:
                    case Gio.FileType.SYMBOLIC_LINK:
                        branch = this.move(child, destChild, cancellable);
                        break;

                    case Gio.FileType.DIRECTORY:
                        branch = this.recursiveMove(child, destChild,
                            cancellable);
                        break;

                    default:
                        continue;
                }

                branches.push(branch);
            }
        }

        return Promise.all(branches);
    },

    /**
     * Asynchronously read and deserialize JSON from @file.
     *
     * @param {Gio.File} file - output file
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<Array|Object>} a deserialized array or object
     */
    getJson: function (file, cancellable = null) {
        return new Promise((resolve, reject) => {
            file.load_contents_async(cancellable, (_file, result) => {
                try {
                    const [, contents] = _file.load_contents_finish(result);
                    const json = ByteArray.toString(contents);

                    resolve(JSON.parse(json));
                } catch (e) {
                    reject(e);
                }
            });
        });
    },

    /**
     * Asynchronously serialize and write @obj to @file.
     *
     * @param {Gio.File} file - output file
     * @param {Array|Object} obj - array or object to serialize
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise) a Promise for the operation
     */
    setJson: function (file, obj, cancellable = null) {
        return new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(
                new GLib.Bytes(JSON.stringify(obj)),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                cancellable,
                (_file, res) => {
                    try {
                        resolve(_file.replace_contents_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    },
};

