'use strict'

const request = require('request')

class DebridLinkClient {

	constructor (token, defaultOptions = {}) {
		this.token = token
		this.base_url = defaultOptions.base_url || 'https://debrid-link.fr/api/v2/'
		this.defaultOptions = defaultOptions
		delete this.defaultOptions.base_url
		this._initMethods()

	}

	_request (endpoint, o = {}) {
		const url = this.base_url + endpoint

		const options = Object.assign({}, this.defaultOptions)
		options.url = url
		options.json = true
		options.qs = o.qs || {}
		options.headers = options.headers || {}
		options.headers['Authorization'] = 'Bearer ' + this.token

		for (let i in o) {
			options[i] = o[i]
		}

		return new Promise((resolve, reject) => {

			request(options, (error, response, body) => {
				if (error) {
					reject(error)
				} else {
					if (typeof body !== 'undefined') {
						if (options.binary) body = JSON.parse(body)
						if (body.error) {
							reject(body.error)
						} else {
							resolve(body)
						}
					} else if (response.statusCode === 200) {
						resolve()
					} else {
						reject()
					}
				}
			})

		})

	}

	_get (endpoint, options = {}) {
		options.method = 'get'
		options.qs = options.qs || {}
		if (this.defaultOptions.ip) {
			options.qs.ip = this.defaultOptions.ip
		}
		return this._request(endpoint, options)
	}

	_delete (endpoint, options = {}) {
		options.method = 'delete'
		return this._request(endpoint, options)
	}

	_post (endpoint, options = {}) {
		options.method = 'post'
		options.form = options.form || {}
		if (this.defaultOptions.ip) {
			options.form.ip = this.defaultOptions.ip
		}
		return this._request(endpoint, options)
	}

	_initMethods () {
		this.account = {
			infos: () => {
				return this._get('account/infos')
			},
			update: (https = 1, themeDark = 0, forceTranscode = 0, hideOldLinks = 0, avatarUrl= null) => {
				return this._post('account/update', {
					form: {
						https,
						themeDark,
						forceTranscode,
						hideOldLinks,
						avatarUrl
					}
				})
			}
		}

		this.seedbox = {
			list: (ids = null, page = 0, perPage = 50) => {
				return this._get('seedbox/list', {
					qs: {
						ids,
						page,
						perPage
					}
				})
			},
			activity: (ids = null, page = 0, perPage = 50) => {
				return this._get('seedbox/activity', {
					qs: {
						ids,
						page,
						perPage
					}
				})
			},
			add: (url= null, wait = false, async = false) => {
				return this._post('seedbox/add', {
					form: {
						url,
						wait,
						async
					}
				})
			},
			cached: (url = null) => {
				return this._get('seedbox/cached', {
					qs: {
						url
					}
				})
			},
			remove: (idTorrents = null) => {
				return this._delete(`seedbox/${idTorrents}/remove`)
			},
			zip: (idTorrent= null, ids = null) => {
				return this._post(`seedbox/${idTorrent}/zip`, {
					form: {
						ids
					}
				})
			},
			config: (idTorrent= null, ids = null) => {
				return this._post(`seedbox/${idTorrent}/config`, {
					form: {
						'files-unwanted': ids
					}
				})
			},
			limits: () => {
				return this._get('seedbox/limits')
			},
			limitsCompare: () => {
				return this._get('seedbox/limits/compare')
			}
		}

		this.rss = {
			list: () => {
				return this._get('seedbox/rss/list')
			},
			add: (url= null, name = null) => {
				return this._post('seedbox/rss/add', {
					form: {
						url,
						name
					}
				})
			},
			test: (id= null, { autoEnabled, filterMethod, filterIncludeRegex, filterExcludeRegex, filterIncludeWords, filterExcludeWords } = {}) => {
				return this._post(`seedbox/rss/${id}/test`, {
					form: {
						autoEnabled,
						filterMethod,
						filterIncludeRegex,
						filterExcludeRegex,
						filterIncludeWords,
						filterExcludeWords
					}
				})
			},
			update: (id= null, { autoEnabled, filterMethod, filterIncludeRegex, filterExcludeRegex, filterIncludeWords, filterExcludeWords } = {}) => {
				return this._post(`seedbox/rss/${id}/update`, {
					form: {
						autoEnabled,
						filterMethod,
						filterIncludeRegex,
						filterExcludeRegex,
						filterIncludeWords,
						filterExcludeWords
					}
				})
			},
			remove: (ids = null) => {
				return this._delete(`seedbox/rss/${ids}/remove`)
			},
			limits: () => {
				return this._get('seedbox/rss/limits')
			},
			limitsCompare: () => {
				return this._get('seedbox/rss/limits/compare')
			}
		}

		this.downloader = {
			list: (page = 0, perPage = 50) => {
				return this._get('downloader/list', {
					qs: {
						page,
						perPage
					}
				})
			},
			add: (url= null, password = null) => {
				return this._post('downloader/add', {
					form: {
						url,
						password
					}
				})
			},
			remove: (idLinks = null) => {
				return this._delete(`downloader/${idLinks}/remove`)
			},
			hosts: (types = null, keys = null) => {
				return this._get('downloader/hosts', {
					qs: {
						types,
						keys
					}
				})
			},
			domains: () => {
				return this._get('downloader/domains')
			},
			limits: () => {
				return this._get('downloader/limits')
			}
		}

		this.files = {
			list: (idParent = null, page = 0, perPage = 50) => {
				return this._get(`files/${idParent}/list`, {
					qs: {
						page,
						perPage
					}
				})
			}
		}

		this.transcode = {
			add: (id= null) => {
				return this._post('stream/transcode/add', {
					form: {
						id
					}
				})
			},
			infos: (id= null) => {
				return this._get(`stream/transcode/${id}/infos`)
			}
		}

	}

}

module.exports = DebridLinkClient
