// 主进程与渲染层共享的通知配置类型（放在中立目录，双端 tsconfig 均包含）。

export interface SystemNotifyChannel {
  enabled: boolean
}

export interface WecomChannel {
  enabled: boolean
  /** 企业微信群机器人 webhook（含 key） */
  webhook: string
}

export interface FeishuChannel {
  enabled: boolean
  /** 飞书自定义机器人 webhook */
  webhook: string
  /** 加签密钥（机器人安全设置选择「自定义关键词」之外的「加签」时必填；留空 = 不加签） */
  secret: string
}

export interface DingtalkChannel {
  enabled: boolean
  /** 钉钉自定义机器人 webhook（含 access_token） */
  webhook: string
  /** 加签密钥（机器人安全设置勾选「加签」时必填） */
  secret: string
}

export interface EmailChannel {
  enabled: boolean
  host: string
  port: number
  /** true = 465 隐式 TLS；false = STARTTLS（587 等端口） */
  secure: boolean
  username: string
  /** SMTP 授权码（非登录密码） */
  password: string
  /** 发件人；留空时用 username */
  from: string
  /** 收件人，多个用逗号分隔 */
  to: string
}

export interface NotifyConfig {
  /** 通知总开关（关闭后不检查、不推送） */
  enabled: boolean
  /** 即将超时节点是否通知 */
  notifyOnSoon: boolean
  /** 已超时节点是否通知 */
  notifyOnOverdue: boolean
  system: SystemNotifyChannel
  wecom: WecomChannel
  feishu: FeishuChannel
  dingtalk: DingtalkChannel
  email: EmailChannel
}

/** 通知渠道标识（channels.ts 的 sender 注册表与设置页共用） */
export type NotifyChannelId = 'system' | 'wecom' | 'feishu' | 'dingtalk' | 'email'
