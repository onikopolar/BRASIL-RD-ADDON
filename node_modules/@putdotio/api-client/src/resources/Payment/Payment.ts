import { PutioAPIClient } from '../../client'
import {
  IUserPaymentInfoResponse,
  IVoucherInfoResponse,
  INanoPaymentRequestResponse,
  IOpenNodeChargeResponse,
  IPaymentOptionsResponse,
  IChangePlanGetResponse,
  IChangePlanPostResponse,
  IChangePlanRequestParams,
} from './types'

export default class Payment {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Info() {
    return this.client.get<IUserPaymentInfoResponse>('/payment/info')
  }

  public Plans() {
    return this.client.get('/payment/plans')
  }

  public Options() {
    return this.client.get<IPaymentOptionsResponse>('/payment/options')
  }

  public History({ unReportedOnly = false } = {}) {
    return this.client.get('/payment/history', {
      params: {
        unreported_only: unReportedOnly,
      },
    })
  }

  public Invites() {
    return this.client.get('/payment/invites')
  }

  public ChangePlan = {
    GET: (params: IChangePlanRequestParams) => {
      return this.client.get<IChangePlanGetResponse>(
        `/payment/change_plan/${params.plan_path}`,
        {
          params: {
            payment_type: params.payment_type,
            coupon_code: params.coupon_code,
          },
        },
      )
    },

    POST: (params: IChangePlanRequestParams) => {
      return this.client.post<IChangePlanPostResponse>(
        `/payment/change_plan/${params.plan_path}`,
        {
          data: {
            payment_type: params.payment_type,
            confirmation_code: params.confirmation_code,
          },
          params: {
            coupon_code: params.coupon_code,
          },
        },
      )
    },
  }

  public CreateNanoPaymentRequest({ planCode }: { planCode: string }) {
    return this.client.post<INanoPaymentRequestResponse>(
      '/payment/methods/nano/request',
      {
        data: {
          plan_code: planCode,
        },
      },
    )
  }

  public CreateOpenNodeCharge({ planPath }: { planPath: string }) {
    return this.client.post<IOpenNodeChargeResponse>(
      '/payment/methods/opennode/charge',
      {
        data: {
          plan_fs_path: planPath,
        },
      },
    )
  }

  public CancelSubscription() {
    return this.client.post('/payment/stop_subscription')
  }

  public GetVoucherInfo(code: string) {
    return this.client.get<IVoucherInfoResponse>(
      `/payment/redeem_voucher/${code}`,
    )
  }

  public RedeemVoucher(code: string) {
    return this.client.post(`/payment/redeem_voucher/${code}`)
  }

  public Report(paymentIds = []) {
    return this.client.post('/payment/report', {
      data: {
        payment_ids: paymentIds.join(','),
      },
    })
  }

  public AddWaitingPayment(data: any) {
    return this.client.post('/payment/paddle_waiting_payment', { data })
  }
}
