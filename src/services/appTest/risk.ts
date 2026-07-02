const HIGH_RISK_TOKENS = [
  'pay',
  'payment',
  'purchase',
  'delete',
  'remove',
  'production',
  'submit production',
  'transfer',
  'checkout',
  '支付',
  '付款',
  '删除',
  '移除',
  '提交生产',
  '生产数据',
  '转账',
  '下单',
  '购买',
  '注销',
  '授权登录',
]

export function isHighRiskAppTestInput(input: unknown): boolean {
  const text = JSON.stringify(input ?? '').toLowerCase()
  return HIGH_RISK_TOKENS.some(token => text.includes(token.toLowerCase()))
}
