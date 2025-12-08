'use strict'
const request = require('request')

class OffcloudClient {

	constructor (token, defaultOptions = {}) {
		this.token = token
		this.base_url = defaultOptions.base_url || 'https://offcloud.com/api/'
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
		options.qs['key'] = this.token

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
						if (body.status === 'error' || body.error) {
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

		this.instant = {
			download: (url, proxyId = null) => {
				return this._post('instant', {
					form: {
						url,
						proxyId
					}
				})
			},
			cache: (hashes) => {
				return this._post('cache', {
					form: {
						hashes
					}
				})
			},
			status: (requestId) => {
				return this._post('instant/status', {
					form: {
						requestId
					}
				})
			},
			history: () => {
				return this._get('instant/history')
			},
			proxies: () => {
				return this._post('proxy/list')
			},
		}

		this.cloud = {
			download: (url) => {
				return this._post('cloud', {
					form: {
						url
					}
				})
			},
			retry: (requestId) => {
				return this._get(`cloud/retry/${requestId}`)
			},
			explore: (requestId) => {
				return this._get(`cloud/explore/${requestId}`)
			},
			status: (requestId) => {
				return this._post('cloud/status', {
					form: {
						requestId
					}
				})
			},
			history: () => {
				return this._get('cloud/history')
			},
		}

		this.remote = {
			download: (url, remoteOptionId, folderId) => {
				return this._post('remote', {
					form: {
						url,
						remoteOptionId,
						folderId
					}
				})
			},
			retry: (requestId) => {
				return this._get(`remote/retry/${requestId}`)
			},
			status: (requestId) => {
				return this._post('remote/status', {
					form: {
						requestId
					}
				})
			},
			accounts: () => {
				return this._post('account/remote/all')
			},
		}

	}

}

module.exports = OffcloudClient
