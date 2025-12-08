'use strict'

const fs = require('fs')
const request = require('request')

class AllDebridClient {

	constructor (token, defaultOptions = {}) {

		this.token = token
		this.ip = defaultOptions.ip
		this.base_agent = defaultOptions.base_agent || 'node-all-debrid'
		this.base_url = defaultOptions.base_url || 'https://api.alldebrid.com/v4/'
		this.defaultOptions = defaultOptions
		delete this.defaultOptions.ip
		delete this.defaultOptions.base_agent
		delete this.defaultOptions.base_url
		this._initMethods()

	}

	_readFile (path) {

		return fs.createReadStream(path)

	}

	_request (endpoint, o = {}) {

		const url = this.base_url + endpoint

		const options = Object.assign({}, this.defaultOptions)
		options.url = url
		options.json = true
		options.qs = o.qs || {}
		options.qs.ip = this.ip
		options.qs.agent = this.base_agent
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
						if (body.status === 'error') {
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
		return this._request(endpoint, options)
	}

	_post (endpoint, options = {}) {
		options.method = 'post'
		return this._request(endpoint, options)
	}

	_initMethods () {
		this.pin = {
			get: () => {
				return this._get('pin/get')
			},
			check: (check, pin) => {
				return this._get('pin/check', {
					qs: {
						check,
						pin
					}
				})
			},
		}

		this.hosts = {
			supported: (hostsOnly = null) => {
				return this._get('hosts', {
					qs: {
						hostsOnly
					}
				})
			},
			domains: () => {
				return this._get('hosts/domains')
			},
			regexp: () => {
				return this._get('hosts/regexp')
			},
			priority: () => {
				return this._get('hosts/priority')
			},
		}

		this.user = {
			info: () => {
				return this._get('user')
			},
			hosts: (hostsOnly = null) => {
				return this._get('user/hosts', {
					qs: {
						hostsOnly
					}
				})
			},
			links: () => {
				return this._get('user/links')
			},
			saveLink: (link) => {
				return this._get('user/links/save', {
					qs: {
						link
					}
				})
			},
			deleteLink: (link) => {
				return this._get('user/links/delete', {
					qs: {
						link
					}
				})
			},
			recentLinks: () => {
				return this._get('user/history')
			},
			purgeRecentLinks: () => {
				return this._get('user/history/delete')
			}
		}

		this.link = {
			infos: (link, password = null) => {
				return this._get('link/infos', {
					qs: {
						link,
						password
					}
				})
			},
			redirector: (link) => {
				return this._get('link/redirector', {
					qs: {
						link
					}
				})
			},
			unlock: (link, password = null) => {
				return this._get('link/unlock', {
					qs: {
						link,
						password
					}
				})
			},
			streaming: (id, stream) => {
				return this._get('link/streaming', {
					qs: {
						id,
						stream
					}
				})
			},
			delayed: (id) => {
				return this._get('link/delayed', {
					qs: {
						id
					}
				})
			}
		}

		this.magnet = {
			upload: (magnets) => {
				return this._post('magnet/upload', {
					form: {
						magnets
					}
				})
			},
			uploadFile: (file) => {
				const stream = (file.Readable) ? file : this._readFile(file)
				return this._post('magnet/upload/file', {
					form: {
						files: [stream],
					}
				})
			},
			status: (id) => {
				return this._get('magnet/status', {
					qs: {
						id
					}
				})
			},
			delete: (id) => {
				return this._get('magnet/delete', {
					qs: {
						id
					}
				})
			},
			restart: (id) => {
				return this._get('magnet/restart', {
					qs: {
						id
					}
				})
			},
			instant: (magnets) => {
				return this._post('magnet/instant', {
					form: {
						magnets
					}
				})
			},
		}

	}

}

module.exports = AllDebridClient
