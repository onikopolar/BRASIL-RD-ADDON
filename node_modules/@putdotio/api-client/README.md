<div align="center">
  <p>
    <img src="https://static.put.io/images/putio-boncuk.png" width="72">
  </p>

  <h1>putio-js</h1>

  <p>
    JavaScript SDK for interacting with the <a href="https://api.put.io/v2/docs">put.io API.</a>
  </p>

  <p>
    <a href="https://github.com/putdotio/putio-js/actions/workflows/push.yml"><img
        src="https://img.shields.io/github/actions/workflow/status/putdotio/putio-js/push.yml?branch=master"
        alt="Build Status"></a>
    <a href="https://coveralls.io/github/putdotio/putio-js?branch=master"><img
        src="https://coveralls.io/repos/github/putdotio/putio-js/badge.svg?branch=master" alt="Coverage Status"></a>
    <img src="https://img.shields.io/npm/v/@putdotio/api-client" alt="npm (scoped)">
    <img src="https://img.shields.io/bundlephobia/minzip/@putdotio/api-client" alt="npm bundle size (scoped)">
    <img src="https://img.shields.io/github/license/putdotio/putio-js" alt="GitHub">
  </p>
</div>

## Installation

```bash
yarn add @putdotio/api-client

npm install @putdotio/api-client
```

#### ES Modules / TypeScript

```ts
import PutioAPI from '@putdotio/api-client'
```

#### CommonJS

```js
const PutioAPI = require('@putdotio/api-client').default
```

## Usage

```ts
// you can pass the options in constructor
const putioAPI = new PutioAPI({ clientID: 'OAUTH_CLIENT_ID' })

// or use `configure` method
MyApp.bootstrap(config => {
  putioAPI.configure({ clientID: config.OAUTH_CLIENT_ID })
})

// setToken will send the given auth token with every request, in Authorization header
MyApp.onLogin(token => {
  putioAPI.setToken(token)

  putioAPI.Account.Info()
    .then(r => console.log('Fetched user info: ', r))
    .catch(e => console.log('An error occurred while fetching user info: ', e))
})

// clearToken will perform a clean-up and stop sending the token in Authorization header
MyApp.onLogout(() => {
  putioAPI.clearToken()
})
```

## API

### Options

| Prop          | Type   | Default Value                          | Description                                                           |
| :------------ | :----- | :------------------------------------- | :-------------------------------------------------------------------- |
| **clientID**  | number | 1                                      | OAuth app client ID, defaults to [put.io web app](https://app.put.io) |
| **baseURL**   | string | [api.put.io/v2](https://api.put.io/v2) | Base URL of the API                                                   |
| **webAppURL** | string | [app.put.io](https://app.put.io)       | Base URL of the Put.io web app, used in the authentication flow       |

### Methods

| Name           | Parameters                          | Return Value            |
| :------------- | :---------------------------------- | :---------------------- |
| **configure**  | `(options: IPutioAPIClientOptions)` | PutioAPIClient Instance |
| **setToken**   | `(token: string)`                   | PutioAPIClient Instance |
| **clearToken** |                                     | PutioAPIClient Instance |

### Events

| Value                 | Payload                                                                                              | Description                             |
| :-------------------- | :--------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| **ERROR**             | [IPutioAPIClientError](https://github.com/putdotio/putio-js/blob/master/src/client/types.ts#L22-L26) | Fired when an HTTP request fails        |
| **CLIENT_IP_CHANGED** | `{ IP: string, newIP: string }`                                                                      | Fired when the IP of the client changes |
