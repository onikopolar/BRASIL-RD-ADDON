type PlanCode = string
type PlanGroupCode = string
type PlanName = string
type PlanDiskSize = number
type PlanExpirationDate = string

export type PlanType = 'onetime' | 'subscription'

export type UserSubscriptionStatus =
  | 'CANCELED'
  | 'PAST_DUE'
  | 'ACTIVE'
  | 'TRIALING'

export interface IUserSubscription {
  id: number
  status: UserSubscriptionStatus
  next_billing_date?: string
  next_retry_date?: string
  update_url?: string
  need_payment_information_update?: boolean
}

export interface IUserPlan {
  type: PlanType
  code: PlanCode
  group_code: PlanGroupCode
  storage_space: number
  period_days?: number
  subscription?: IUserSubscription
}

export interface IUserPayment {
  method: string
  provider: string
}

export interface IUserPaymentInfoResponse {
  expiration_date: string
  extend_30: string
  extend_365: string
  has_pending_payment: boolean
  last_payment?: IUserPayment
  plan?: IUserPlan
  pending_bitpay: string | null
}

export interface IVoucherInfoResponse {
  current_plan: {
    type: PlanType | null
    expiration_date: PlanExpirationDate
  }
  target_plan: {
    type: PlanType
    name: PlanName
    code: PlanCode
    group_code: PlanGroupCode
    hd_avail: PlanDiskSize
    simulated_expiration?: PlanExpirationDate
  }
  new_remaining_days: number
}

export interface INanoPaymentRequestResponse {
  nano: {
    token: string
  }
}

export interface IOpenNodeChargeResponse {
  opennode: {
    checkout_url: string
  }
}

type PaymentProviderPaddle = {
  plan_id: number
  provider: 'Paddle'
  type: 'credit-card'
  vendor_id: number
}

type PaymentProviderFastspring = {
  provider: 'Fastspring'
  type: 'credit-card'
  url: string
}

type PaymentProviderOpenNode = {
  provider: 'OpenNode'
  type: 'cryptocurrency'
  discount_percent: number
}

type PaymentProviderAcceptNano = {
  amount: string
  api_host: string
  currency: 'USD'
  provider: 'AcceptNano'
  state: string
  type: 'nano'
  discount_percent: number
}

export type PaymentProvider =
  | PaymentProviderAcceptNano
  | PaymentProviderFastspring
  | PaymentProviderOpenNode
  | PaymentProviderPaddle

export type PaymentProviderName = PaymentProvider['provider']

export type PaymentType = PaymentProvider['type']

export type PaymentOption = {
  name: PaymentType
  suitable_plan_types: (PlanType | 'trial')[]
  default?: boolean
  discount_percent: number
}

export interface IPaymentOptionsResponse {
  options: PaymentOption[]
}

export interface IChangePlanRequestParams {
  plan_path: string
  payment_type: PaymentType
  coupon_code?: string
  confirmation_code?: string
}

export interface IChangePlanGetResponse {
  amount: string
  current_plan: {
    plan_type?: PlanType
    subscription_payment_provider?: PaymentProviderName
  }
  target_plan: {
    price: string
    plan_type: PlanType
    period_days: number
    plan_code: PlanCode
    plan_name: PlanName
    hd_avail: PlanDiskSize
    simulated_expiration?: PlanExpirationDate
    new_code: PlanCode
    is_trial_subscription: boolean
    subscription_trial_period?: number
  }
  Paddle: {
    charge_amount: string
    currency: string
    next_billing_date: string
  }
  Fastspring: {
    prorated_amount: string
    refund_amount: string
    charge_amount: string
    currency: string
  }
  new_remaining_days: number
  prorated: string
  credit: string
  charge_amount: boolean
  currency: string
  is_product_change: boolean
  discount?: {
    discount: number
    type: 'percentage' | 'amount'
  }
}

type ChangePlanURLsResponse = {
  urls: PaymentProvider[]
}

type ChangePlanConfirmationResponse = {
  confirmation: true
}

type ChangePlanSubscriptionUpgradeDowngradeResponse = {
  charged_amount: string
  charged_currency: string
  next_payment: {
    amount: string
    billing_date: string
    currency: string
  }
}

type ChangePlanEmptyResponse = {}

export type IChangePlanPostResponse =
  | ChangePlanURLsResponse
  | ChangePlanConfirmationResponse
  | ChangePlanSubscriptionUpgradeDowngradeResponse
  | ChangePlanEmptyResponse
