'use strict'

const fs = require('fs')
const request = require('request')

class PremiumizeClient {

	constructor (token, defaultOptions = {}) {

		this.token = token
		this.defaultOptions = defaultOptions
		this.base_url = defaultOptions.base_url || 'https://www.premiumize.me/api/'
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
		options.qs.apikey = this.token

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
							reject({
								message: body.message
							})
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
		this.folder = {
			list: (id, includebreadcrumbs = null, download_ip = null) => {
				return this._get('folder/list', {
					qs: {
						id,
						includebreadcrumbs,
						download_ip
					}
				})
			},
			create: (name, parent_id = null) => {
				return this._post('folder/create', {
					form: {
						name,
						parent_id
					}
				})
			},
			rename: (id, name) => {
				return this._post('folder/rename', {
					form: {
						id,
						name
					}
				})
			},
			paste: (id, files = null, folders = null) => {
				return this._post('folder/paste', {
					form: {
						id,
						files,
						folders
					}
				})
			},
			delete: (id) => {
				return this._post('folder/delete', {
					form: {
						id
					}
				})
			},
			uploadInfo: (id) => {
				return this._get('folder/uploadinfo', {
					qs: {
						id
					}
				})
			}
		}

		this.item = {
			listAll: () => {
				return this._get('item/listall')
			},
			rename: (id, name) => {
				return this._post('item/rename', {
					form: {
						id,
						name
					}
				})
			},
			delete: (id) => {
				return this._post('item/delete', {
					form: {
						id
					}
				})
			},
			details: (id) => {
				return this._get('item/details', {
					qs: {
						id
					}
				})
			}
		}

		this.transfer = {
			list: () => {
				return this._get('transfer/list')
			},
			create: (src, file = null, folder_id = null) => {
				const stream = file ? (file.Readable) ? file : this._readFile(file) : null
				return this._post('transfer/create', {
					form: {
						src,
						file: stream,
						folder_id
					}
				})
			},
			directDownload: (src, download_ip = null) => {
				return this._post('transfer/directdl', {
					form: {
						src,
						download_ip
					}
				})
			},
			clearFinished: () => {
				return this._post('transfer/clearfinished')
			},
			delete: (id) => {
				return this._post('transfer/delete', {
					form: {
						id
					}
				})
			}
		}

		this.account = {
			info: () => {
				return this._get('account/info')
			}
		}

		this.zip = {
			generate: (files, folders) => {
				return this._post('zip/generate', {
					form: {
						files,
						folders
					}
				})
			}
		}

		this.cache = {
			check: (items) => {
				return this._get('cache/check', {
					qs: {
						items
					}
				})
			}
		}

		this.services = {
			list: () => {
				return this._get('services/list')
			}
		}

	}

}

module.exports = PremiumizeClient
