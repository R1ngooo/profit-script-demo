import { describe, expect, it } from 'vitest'
import { classifyStatus } from '../../shared/rules'

describe('classifyStatus', () => {
  it('订单关闭一律退款', () => {
    expect(classifyStatus('交易关闭', '退款成功').classification).toBe('refund')
    expect(classifyStatus('已取消', '退货退款完成').classification).toBe('refund')
    expect(classifyStatus('交易关闭', '').classification).toBe('refund')
  })

  it('退款关闭/被拒按预估结算', () => {
    expect(classifyStatus('交易成功', '退款关闭').classification).toBe('settle')
    expect(classifyStatus('已完成', '用户取消申请').classification).toBe('settle')
    expect(classifyStatus('已完成', '平台处理完成，售后关闭').classification).toBe('settle')
    expect(classifyStatus('已完成', '商家拒绝退款').classification).toBe('settle')
  })

  it('售后进行中与退货退款按退款', () => {
    expect(classifyStatus('已发货', '待商家收货').classification).toBe('refund')
    expect(classifyStatus('已收货', '待买家退货').classification).toBe('refund')
    expect(classifyStatus('已完成', '售后协商中').classification).toBe('refund')
    expect(classifyStatus('已完成', '退款完成').classification).toBe('refund')
    expect(classifyStatus('已发货', '退货退款完成').classification).toBe('refund')
    expect(classifyStatus('发货中', '仅退款中').classification).toBe('refund')
  })

  it('正常订单无售后按预估结算', () => {
    expect(classifyStatus('交易成功', '').classification).toBe('settle')
    expect(classifyStatus('已完成', '无').classification).toBe('settle')
    expect(classifyStatus('已发货', '').classification).toBe('settle')
    expect(classifyStatus('已签收', '无售后').classification).toBe('settle')
    expect(classifyStatus('等待确认收货', '').classification).toBe('settle')
    expect(classifyStatus('卖家已发货，等待买家确认', '没有申请退款').classification).toBe('settle')
  })

  it('多平台状态词：已关闭/换货/售后完成/售后取消', () => {
    expect(classifyStatus('已关闭', '售后关闭').classification).toBe('refund')
    expect(classifyStatus('完成', '换货').classification).toBe('settle')
    expect(classifyStatus('完成', '换货').ruleId).toBe('exchange')
    expect(classifyStatus('已完成', '售后完成').classification).toBe('refund')
    expect(classifyStatus('已完成', '售后处理中').classification).toBe('refund')
    expect(classifyStatus('已发货，待收货', '无售后或售后取消').classification).toBe('settle')
    expect(classifyStatus('已发货，退款成功', '无售后或售后取消').classification).toBe('refund')
    expect(classifyStatus('已收货，退款成功', '退款成功').classification).toBe('refund')
    expect(classifyStatus('已完成', '取消售后').classification).toBe('settle')
    expect(classifyStatus('已完成', '待收退货').classification).toBe('refund')
    expect(classifyStatus('已完成', '换货成功').classification).toBe('settle')
    expect(classifyStatus('已完成', '补寄待收货').classification).toBe('settle')
    expect(classifyStatus('已发货', '售后待处理').classification).toBe('refund')
    expect(classifyStatus('已发货', '平台处理中').classification).toBe('refund')
    expect(classifyStatus('已完成', '协商期').classification).toBe('refund')
    expect(classifyStatus('已完成', '售后已拒绝').classification).toBe('settle')
  })

  it('未识别状态给出 unknown 标记但默认结算', () => {
    const result = classifyStatus('待核实', '奇怪状态')
    expect(result.classification).toBe('settle')
    expect(result.unknown).toBe(true)
  })
})
