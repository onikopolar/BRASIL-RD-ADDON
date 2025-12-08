import { Base64 } from 'js-base64'
import URI from 'urijs'
import { PutioAPIClient } from '../../client'
import {
  IGenerateTOTPResponse,
  ILoginResponse,
  IVerifyTOTPResponse,
  IValidateTokenResponse,
  OAuthApp,
  OAuthAppSession,
  TwoFactorRecoveryCodes,
} from './types'

class TwoFactor {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public GenerateTOTP() {
    return this.client.post<IGenerateTOTPResponse>('/two_factor/generate/totp')
  }

  public VerifyTOTP(twoFactorScopedToken: string, code: string) {
    return this.client.post<IVerifyTOTPResponse>('/two_factor/verify/totp', {
      params: { oauth_token: twoFactorScopedToken },
      data: { code },
    })
  }

  public GetRecoveryCodes() {
    return this.client.get<{ recovery_codes: TwoFactorRecoveryCodes }>(
      '/two_factor/recovery_codes',
    )
  }

  public RegenerateRecoveryCodes() {
    return this.client.post<{ recovery_codes: TwoFactorRecoveryCodes }>(
      '/two_factor/recovery_codes/refresh',
    )
  }
}

export default class Auth {
  private client: PutioAPIClient

  public TwoFactor: TwoFactor

  constructor(client: PutioAPIClient) {
    this.client = client
    this.TwoFactor = new TwoFactor(client)
  }

  public GetLoginURL({
    redirectURI,
    responseType = 'token',
    state,
    clientID,
    clientName,
  }: {
    redirectURI: string
    responseType: string
    state: string
    clientID: string
    clientName?: string
  }): string {
    const { options } = this.client

    const url = new URI(`${options.webAppURL}/authenticate`).addQuery({
      client_id: clientID || options.clientID,
      client_name: clientName,
      redirect_uri: redirectURI,
      response_type: responseType,
      isolated: 1,
      state,
    })

    return url.toString()
  }

  public Login({
    username,
    password,
    app,
  }: {
    username: string
    password: string
    app: {
      client_id: string
      client_secret: string
    }
  }) {
    return this.client.put<ILoginResponse>(
      `/oauth2/authorizations/clients/${app.client_id}?client_secret=${app.client_secret}`,
      {
        headers: {
          Authorization: `Basic ${Base64.encode(`${username}:${password}`)}`,
        },
      },
    )
  }

  public Logout() {
    return this.client.post('/oauth/grants/logout')
  }

  public Register(data: any) {
    return this.client.post('/registration/register', {
      data: {
        client_id: this.client.options.clientID,
        ...data,
      },
    })
  }

  public Exists(key: string, value: string) {
    return this.client.get(`/registration/exists/${key}`, {
      params: { value },
    })
  }

  public GetVoucher(code: string) {
    return this.client.get(`/registration/voucher/${code}`)
  }

  public GetGiftCard(code: string) {
    return this.client.get(`/registration/gift_card/${code}`)
  }

  public GetFamilyInvite(code: string) {
    return this.client.get(`/registration/family/${code}`)
  }

  public ForgotPassword(mail: string) {
    return this.client.post('/registration/password/forgot', {
      data: { mail },
    })
  }

  public ResetPassword(key: string, newPassword: string) {
    return this.client.post('/registration/password/reset', {
      data: {
        key,
        password: newPassword,
      },
    })
  }

  public GetCode(clientID: number | string, clientName?: string) {
    return this.client.get<{ code: string; qr_code_url: string }>(
      '/oauth2/oob/code',
      {
        params: { app_id: clientID, client_name: clientName },
      },
    )
  }

  public CheckCodeMatch(code: string) {
    return this.client.get<{ oauth_token: string | null }>(
      `/oauth2/oob/code/${code}`,
    )
  }

  public LinkDevice(code: string) {
    return this.client.post<{ app: OAuthApp }>('/oauth2/oob/code', {
      data: { code },
    })
  }

  public Grants() {
    return this.client.get<{ apps: OAuthApp[] }>('/oauth/grants/')
  }

  public RevokeApp(id: number) {
    return this.client.post<{}>(`/oauth/grants/${id}/delete`)
  }

  public Clients() {
    return this.client.get<{ clients: OAuthAppSession[] }>('/oauth/clients/')
  }

  public RevokeClient(id: string) {
    return this.client.post<{}>(`/oauth/clients/${id}/delete`)
  }

  public RevokeAllClients() {
    return this.client.post<{}>('/oauth/clients/delete-all')
  }

  public ValidateToken(token: string) {
    return this.client.get<IValidateTokenResponse>('/oauth2/validate', {
      params: { oauth_token: token },
    })
  }
}
