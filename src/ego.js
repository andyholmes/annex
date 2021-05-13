// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported EGO */


const ByteArray = imports.byteArray;
const {GLib, GObject, Gio, Soup} = imports.gi;


/* URIs */
const BASE_URI = 'https://extensions.gnome.org';
const EXTENSION_INFO_URI = `${BASE_URI}/extension-info/`;
const EXTENSION_QUERY_URI = `${BASE_URI}/extension-query/`;
const EXTENSION_DOWNLOAD_URI = `${BASE_URI}/download-extension/`;


/* Directories */
const CACHEDIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'annex']);
const CONFIGDIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'annex']);
const DATADIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'annex']);

for (const dir of [CACHEDIR, CONFIGDIR, DATADIR])
    GLib.mkdir_with_parents(dir, 0o755);


/**
 * Enum for search result order.
 *
 * @readonly
 * @enum {string}
 */
var SortType = {
    DOWNLOADS: 'downloads',
    NAME: 'name',
    POPULARITY: 'popularity',
    RECENT: 'recent',
};


/**
 * An object representing a search result.
 */
var ExtensionInfo = GObject.registerClass({
    GTypeName: 'AnnexExtensionInfo',
    Properties: {
        'creator': GObject.ParamSpec.string(
            'creator',
            'Creator',
            'Creator of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'creator-url': GObject.ParamSpec.string(
            'creator-url',
            'Creator URL',
            'The creator page on e.g.o',
            GObject.ParamFlags.READABLE,
            null
        ),
        'description': GObject.ParamSpec.string(
            'description',
            'Description',
            'Description of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'icon': GObject.ParamSpec.object(
            'icon',
            'Icon',
            'Icon of the extension',
            GObject.ParamFlags.READWRITE,
            Gio.Icon.$gtype
        ),
        'name': GObject.ParamSpec.string(
            'name',
            'Name',
            'Name of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'screenshot': GObject.ParamSpec.object(
            'screenshot',
            'Screenshot',
            'Screenshot of the extension',
            GObject.ParamFlags.READWRITE,
            Gio.File.$gtype
        ),
        'url': GObject.ParamSpec.string(
            'url',
            'URL',
            'URL of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'uuid': GObject.ParamSpec.string(
            'uuid',
            'UUID',
            'UUID of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
    },
}, class ExtensionInfo extends GObject.Object {
    _init(info = {}) {
        super._init();

        this.update(info);
        this._load(info);
    }

    _load(info) {
        try {
            const ego = EGO.getDefault();

            if (info.icon) {
                ego.requestFile(info.icon).then(file => {
                    this.icon = new Gio.FileIcon({file});
                }).catch(logError);
            }

            if (info.screenshot) {
                ego.requestFile(info.screenshot).then(file => {
                    this.screenshot = file;
                }).catch(logError);
            }
        } catch (e) {
            logError(e);
        }
    }

    get creator_url() {
        if (this.creator === null)
            return null;

        return `${BASE_URI}/accounts/profile/${this.creator}`;
    }

    get icon() {
        if (this._icon === undefined)
            this._icon = new Gio.ThemedIcon({name: 'plugin'});

        return this._icon;
    }

    set icon(icon) {
        if (this.icon !== icon) {
            this._icon = icon;
            this.notify('icon');
        }
    }

    /**
     * Update with new JSON info.
     *
     * @param {Object} info - An extension info object
     * @param {string} info.uuid - the UUID
     * @param {string} info.name - the name
     * @param {string} info.description - the description
     * @param {string} info.creator - the creator's username
     * @param {Object} info.shell_version_map - the version map
     */
    update(info) {
        this.freeze_notify();

        this.uuid = info.uuid;
        this.name = info.name;
        this.description = info.description;
        this.pk = info.pk;
        this.url = `${BASE_URI}${info.link}`;

        this.creator = info.creator;
        this.shell_version_map = info.shell_version_map;

        this.thaw_notify();
    }
});


/**
 * EGO Singleton
 */
var EGO = class {
    static getDefault() {
        if (this.__default === undefined)
            this.__default = new EGO();

        return this.__default;
    }

    constructor() {
        // File Cache
        this._files = new Map();
        this._files.set('/static/images/plugin.png',
            Gio.File.new_for_uri('resource://ca/andyholmes/Annex/icons/ego-plugin.svg'));

        this._infos = new Map();

        this._session = new Soup.Session({ssl_use_system_ca_file: true});
        Soup.Session.prototype.add_feature.call(this._session,
            new Soup.ProxyResolverDefault());
    }

    _getFile(uri) {
        if (!this._files.has(uri)) {
            const name = GLib.path_get_basename(uri);
            const path = GLib.build_filenamev([CACHEDIR, name]);
            const file = Gio.File.new_for_path(path);

            this._files.set(uri, file);
        }

        return this._files.get(uri);
    }

    _requestBytes(message) {
        return new Promise((resolve, reject) => {
            this._session.queue_message(message, (session, msg) => {
                try {
                    if (msg.status_code !== Soup.KnownStatusCode.OK) {
                        throw new Gio.IOErrorEnum({
                            code: Gio.IOErrorEnum.FAILED,
                            message: msg.reason_phrase,
                        });
                    }

                    resolve(msg.response_body_data);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _requestFile(dest, message, cancellable = null) {
        const sendTask = new Promise((resolve, reject) => {
            this._session.send_async(
                message,
                cancellable,
                (session, result) => {
                    try {
                        resolve(session.send_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        const replaceTask = new Promise((resolve, reject) => {
            dest.replace_async(
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (file, result) => {
                    try {
                        resolve(file.replace_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        const [source, target] = await Promise.all([sendTask, replaceTask]);

        return new Promise((resolve, reject) => {
            target.splice_async(
                source,
                (Gio.OutputStreamSpliceFlags.CLOSE_SOURCE |
                 Gio.OutputStreamSpliceFlags.CLOSE_TARGET),
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (stream, result) => {
                    try {
                        stream.splice_finish(result);
                        resolve(dest);
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    _requestJson(message) {
        return new Promise((resolve, reject) => {
            this._session.queue_message(message, (session, msg) => {
                try {
                    if (msg.status_code !== Soup.KnownStatusCode.OK) {
                        throw new Gio.IOErrorEnum({
                            code: Gio.IOErrorEnum.FAILED,
                            message: msg.reason_phrase,
                        });
                    }

                    const json = JSON.parse(msg.response_body.data);

                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     *
     */
    async requestExtension(dest, uuid, version_tag = null) {
        const parameters = {};
        const uri = `${EXTENSION_DOWNLOAD_URI}/${uuid}.shell-extension.zip`

        if (version_tag !== null)
            parameters.version_tag = version_tag;
        const message = Soup.form_request_new_from_hash('GET',
            EXTENSION_INFO_URI, parameters);

        const bytes = await this._requestBytes(message);
        log(`RECEIVED extension ${uuid}, size ${bytes.get_size()}`);
    }

    /**
     * Send a request for a remote file. The result will be cached locally and
     * a GFile for the local copy will be returned.
     *
     * @param {string} uri - The URI of a remote resource
     * @return {Gio.File} a remote file
     */
    async requestFile(uri) {
        const file = this._getFile(uri);

        if (!file.query_exists(null)) {
            const message = Soup.Message.new('GET', `${BASE_URI}${uri}`);
            await this._requestFile(file, message);
        }

        return file;
    }

    /**
     * Request the extension metadata for a UUID.
     *
     * @param {string} uuid - an extension UUID
     * @return {ExtensionInfo} extension metadata
     */
    async extensionInfo(uuid) {
        const message = Soup.form_request_new_from_hash('GET',
            EXTENSION_INFO_URI, {uuid});

        const json = await this._requestJson(message);
        const info = new ExtensionInfo(json);

        return info;
    }

    /**
     * Request the extension metadata for a UUID.
     *
     * @param {Object} parameters - The query parameters
     * @param {string} parameters.search - The search query
     * @param {string} parameters.sort - The sort type
     * @param {string} parameters.page - The page number
     * @param {string} parameters.shell_version - The GNOME Shell version
     * @return {Object} extension metadata
     */
    extensionQuery(parameters) {
        if (parameters.page !== undefined)
            parameters.page = parameters.page.toString();

        const message = Soup.form_request_new_from_hash('GET',
            EXTENSION_QUERY_URI, parameters);

        return this._requestJson(message);
    }

    /**
     * Lookup the extension info for a UUID.
     *
     * @param {string} uuid - an extension UUID
     * @return {ExtensionInfo} extension metadata
     */
    async lookupExtension(uuid) {
        if (!this._infos.has(uuid)) {
            const info = await this.extensionInfo(uuid);
            this._infos.set(uuid, info);
        }

        return this._infos.get(uuid);
    }

    /**
     * Lookup the extension info for a UUID.
     *
     * @param {string} uuid - an extension UUID
     * @return {ExtensionInfo} extension metadata
     */
    async searchExtensions(parameters) {
        if (parameters.page !== undefined)
            parameters.page = parameters.page.toString();

        const results = await this.extensionQuery(parameters);

        results.parameters = parameters;
        results.extensions = results.extensions.map(result => {
            let info = this._infos.get(result.uuid);

            if (info === undefined) {
                info = new ExtensionInfo(result);
                this._infos.set(info.uuid, info);
            } else {
                info.update(result);
            }

            return info;
        });

        return results;
    }
};


/**
 * A GListModel for search results.
 */
var SearchModel = GObject.registerClass({
    GTypeName: 'AnnexSearchModel',
    Implements: [Gio.ListModel],
    Properties: {
        'n-pages': GObject.ParamSpec.uint(
            'n-pages',
            'Pages',
            'Number of pages',
            GObject.ParamFlags.READABLE,
            1, GLib.MAXUINT32,
            1
        ),
        'page': GObject.ParamSpec.uint(
            'page',
            'Page',
            'Current page',
            GObject.ParamFlags.READWRITE,
            1, GLib.MAXUINT32,
            1
        ),
        'query': GObject.ParamSpec.string(
            'query',
            'Query',
            'The seach query',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'shell-version': GObject.ParamSpec.string(
            'shell-version',
            'Shell Version',
            'The supported GNOME Shell version',
            GObject.ParamFlags.READWRITE,
            'all'
        ),
        'sort': GObject.ParamSpec.string(
            'sort',
            'Sort',
            'The sort order',
            GObject.ParamFlags.READWRITE,
            SortType.POPULARITY
        ),
    },
}, class SearchModel extends GObject.Object {
    _init(params = {}) {
        super._init(params);

        this._items = [];
    }

    get n_pages() {
        if (this._n_pages === undefined)
            this._n_pages = 1;

        return this._n_pages;
    }

    get page() {
        if (this._page === undefined || this._page < 1)
            this._page = 1;

        return this._page;
    }

    set page(page) {
        if (this._page !== page) {
            this._page = Math.min(Math.max(page, 1), this.n_pages);
            this.notify('page');
            this.refresh();
        }
    }

    get query() {
        if (this._query === undefined)
            this._query = '';

        return this._query;
    }

    set query(query) {
        if (this._query !== query) {
            this._query = query;
            this.notify('query');

            this._page = 1;
            this.notify('page');

            this.refresh();
        }
    }

    get shell_version() {
        if (this._shell_version === undefined)
            this._shell_version = 'all';

        return this._shell_version;
    }

    set shell_version(version) {
        if (this._shell_version !== version) {
            this._shell_version = version;
            this.notify('shell-version');

            this._page = 1;
            this.notify('page');

            this.refresh();
        }
    }

    get sort() {
        if (this._sort === undefined)
            this._sort = SortType.POPULARITY;

        return this._sort;
    }

    set sort(type) {
        if (this._sort !== type) {
            this._sort = type;
            this.notify('sort');

            this._page = 1;
            this.notify('page');

            this.refresh();
        }
    }

    vfunc_get_item(position) {
        return this._items[position] || null;
    }

    vfunc_get_item_type() {
        return GObject.Object.$gtype;
    }

    vfunc_get_n_items() {
        return this._items.length;
    }

    /**
     * Refresh the search. This is done automatically when any of the properties
     * are changed.
     *
     * @return {Promise} A promise for the operation.
     */
    async refresh() {
        try {
            this._activeSearch = {
                page: this.page.toString(),
                search: this.query,
                shell_version: this.shell_version,
                sort: this.sort,
            };

            /* Query e.g.o */
            const ego = EGO.getDefault();
            const results = await ego.searchExtensions(this._activeSearch);

            if (this._activeSearch !== results.parameters)
                return;

            /* Update the list model */
            const removals = this._items.length;

            this._items = results.extensions;
            this._n_pages = results.numpages;
            this.notify('n-pages');

            this.items_changed(0, removals, this._items.length);
            this._activeSearch = null;
        } catch (e) {
            logError(e);
        }
    }
});

