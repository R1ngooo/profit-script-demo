import type { Classification } from './types'

export interface ClassifyResult {
  classification: Classification
  ruleId: string
  reason: string
  unknown: boolean
}

/** 订单已关闭：无论售后如何，都视为退款订单 */
const CLOSED_ORDER_KEYWORDS = ['交易关闭', '已取消', '已关闭', '订单关闭', '交易取消', '已作废']

/** 售后已关闭/被拒绝/根本没有申请：退款不会成立，视为预估结算 */
const REFUND_CLOSED_KEYWORDS = [
  '退款关闭',
  '用户取消申请',
  '售后关闭',
  '商家拒绝退款',
  '退款申请撤销',
  '拒绝退款',
  '售后取消',
  '取消售后',
  '没有申请退款',
  '未申请退款',
  '无退款申请',
  '售后已拒绝',
  '售后拒绝',
]

/** 售后进行中：钱还会退，视为退款订单 */
const AFTER_SALE_IN_PROGRESS_KEYWORDS = [
  '待商家收货',
  '待买家退货',
  '待商家受理',
  '待买家处理',
  '待卖家处理',
  '待卖家收货',
  '售后协商中',
  '代买家发起售后',
  '售后处理中',
  '售后待处理',
  '平台处理中',
  '协商期',
]

/** 售后完结但已退款（含退货退款） */
const REFUND_DONE_KEYWORDS = ['退款成功', '退款完成', '退货退款完成', '退货退款成功', '退款已到账', '售后完成']

/** 换货/补发：不产生退款，但商品可能回流，金额上按预估结算 */
const EXCHANGE_KEYWORDS = ['换货', '补发', '补寄', '重新邮寄']

const NORMAL_ORDER_STATUSES = [
  '交易成功',
  '已收货',
  '已发货',
  '已完成',
  '待发货',
  '已付款',
  '完成',
  '确认收货',
  '已签收',
  '等待',
]

function hit(text: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    if (text.includes(keyword)) return keyword
  }
  return null
}

/**
 * 根据「订单状态 + 售后状态」推理：预估结算 or 退款订单。
 * 判定顺序：订单关闭 → 换货 → 退款已关闭 → 售后中 → 已退款 → 订单含退款 → 默认结算。
 */
export function classifyStatus(orderStatusRaw: string, afterSaleStatusRaw: string): ClassifyResult {
  const orderStatus = (orderStatusRaw || '').trim()
  const afterSale = (afterSaleStatusRaw || '').trim()

  const closed = hit(orderStatus, CLOSED_ORDER_KEYWORDS)
  if (closed) {
    return {
      classification: 'refund',
      ruleId: 'closed-order',
      reason: `订单状态「${orderStatus}」属于已关闭/已取消，不产生结算`,
      unknown: false,
    }
  }

  const orderRefund = orderStatus.includes('退款') || orderStatus.includes('退货')
  if (orderRefund) {
    return {
      classification: 'refund',
      ruleId: 'order-status-refund',
      reason: `订单状态「${orderStatus}」已包含退款/退货结果，按退款订单处理`,
      unknown: false,
    }
  }

  const exchange = hit(afterSale, EXCHANGE_KEYWORDS)
  if (exchange) {
    return {
      classification: 'settle',
      ruleId: 'exchange',
      reason: `售后状态「${afterSale}」为换货/补发（${exchange}），不产生退款，按预估结算处理`,
      unknown: false,
    }
  }

  const refundClosed = hit(afterSale, REFUND_CLOSED_KEYWORDS)
  if (refundClosed) {
    return {
      classification: 'settle',
      ruleId: 'refund-closed',
      reason: `售后状态「${afterSale}」表示退款已关闭/未申请，按预估结算处理`,
      unknown: false,
    }
  }

  const inProgress = hit(afterSale, AFTER_SALE_IN_PROGRESS_KEYWORDS)
  if (inProgress) {
    return {
      classification: 'refund',
      ruleId: 'after-sale-in-progress',
      reason: `售后进行中（${inProgress}），按退款订单处理`,
      unknown: false,
    }
  }

  const refundDone = hit(afterSale, REFUND_DONE_KEYWORDS)
  if (refundDone) {
    return {
      classification: 'refund',
      ruleId: 'refund-done',
      reason: `售后状态「${afterSale}」已发生退款/退货，按退款订单处理`,
      unknown: false,
    }
  }

  if (afterSale.includes('退货') || afterSale.includes('退款')) {
    return {
      classification: 'refund',
      ruleId: 'return-flow',
      reason: `售后状态「${afterSale}」包含退货/退款流向（买家→卖家），按退款订单处理`,
      unknown: false,
    }
  }

  if (!afterSale) {
    return {
      classification: 'settle',
      ruleId: 'no-after-sale',
      reason: `订单状态「${orderStatus}」且无售后，按预估结算处理`,
      unknown: false,
    }
  }

  if (hit(orderStatus, NORMAL_ORDER_STATUSES)) {
    return {
      classification: 'settle',
      ruleId: 'normal-settle',
      reason: `订单状态「${orderStatus}」无法匹配退款特征（售后：${afterSale}），默认预估结算`,
      unknown: false,
    }
  }

  return {
    classification: 'settle',
    ruleId: 'unknown',
    reason: `未识别的状态组合（订单：${orderStatus || '空'}，售后：${afterSale}），默认预估结算，建议人工确认`,
    unknown: true,
  }
}

export const RULE_LEGEND: Array<{ id: string; label: string; description: string; tone: Classification | 'neutral' }> = [
  {
    id: 'closed-order',
    label: '订单已关闭',
    description: '订单状态含「交易关闭 / 已取消 / 已关闭」，直接判为退款订单',
    tone: 'refund',
  },
  {
    id: 'exchange',
    label: '换货/补发',
    description: '售后状态含「换货 / 补发 / 重新邮寄」，不产生退款，判为预估结算',
    tone: 'settle',
  },
  {
    id: 'refund-closed',
    label: '退款已关闭',
    description: '售后状态含「退款关闭 / 未申请退款 / 售后取消 / 商家拒绝退款」，判为预估结算',
    tone: 'settle',
  },
  {
    id: 'after-sale-in-progress',
    label: '售后进行中',
    description: '售后状态含「待商家收货 / 待买家退货 / 售后处理中 / 售后协商中」等，判为退款订单',
    tone: 'refund',
  },
  {
    id: 'refund-done',
    label: '退款/退货已完成',
    description: '售后状态含「退款成功 / 退款完成 / 退货退款完成 / 售后完成」，判为退款订单',
    tone: 'refund',
  },
  {
    id: 'no-after-sale',
    label: '无售后',
    description: '无售后状态且订单未关闭，判为预估结算',
    tone: 'settle',
  },
  {
    id: 'unknown',
    label: '待确认',
    description: '未识别的状态组合，默认预估结算并在面板标黄提示',
    tone: 'neutral',
  },
]
