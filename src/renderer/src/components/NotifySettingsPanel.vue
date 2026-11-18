<template>
  <div class="panel">
    <!-- 提醒事件 -->
    <div class="block">
      <div class="block-title">提醒事件</div>
      <div class="switch-row">
        <el-switch v-model="cfg.enabled" />
        <span class="switch-label">启用待办超时通知</span>
      </div>
      <el-checkbox v-model="cfg.notifyOnSoon" :disabled="!cfg.enabled">即将超时提醒（进入「提前 X 分钟」窗口时通知一次）</el-checkbox>
      <el-checkbox v-model="cfg.notifyOnOverdue" :disabled="!cfg.enabled">已超时提醒（跨过截止时间时通知一次，不重复）</el-checkbox>
      <div class="inline-hint">
        仅在 myDash 运行期间检查（约每分钟一轮，启动时补发错过的提醒）。只有配置了截止时间且超时提醒不为「不提醒」的待办才会触发。
      </div>
    </div>

    <!-- 系统通知 -->
    <div class="block">
      <div class="block-title">
        <span>系统通知</span>
        <el-switch v-model="cfg.system.enabled" :disabled="!cfg.enabled" />
      </div>
      <div class="inline-hint">Windows 桌面弹窗，无需配置。推荐常开：即使外部渠道故障也有本机兜底。</div>
      <div class="ch-actions">
        <el-button size="small" :loading="testing.system" @click="test('system')">发送测试</el-button>
      </div>
    </div>

    <!-- 企业微信 -->
    <div class="block">
      <div class="block-title">
        <span>企业微信</span>
        <el-switch v-model="cfg.wecom.enabled" :disabled="!cfg.enabled" />
      </div>
      <el-form label-width="92px" class="form">
        <el-form-item label="Webhook">
          <el-input
            v-model="cfg.wecom.webhook"
            type="password"
            show-password
            placeholder="群机器人 Webhook 地址（https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…）"
          />
        </el-form-item>
      </el-form>
      <div class="inline-hint">群聊中添加「群机器人」后复制 Webhook 地址。</div>
      <div class="ch-actions">
        <el-button size="small" :loading="testing.wecom" :disabled="!cfg.wecom.enabled" @click="test('wecom')">发送测试</el-button>
      </div>
    </div>

    <!-- 飞书 -->
    <div class="block">
      <div class="block-title">
        <span>飞书</span>
        <el-switch v-model="cfg.feishu.enabled" :disabled="!cfg.enabled" />
      </div>
      <el-form label-width="92px" class="form">
        <el-form-item label="Webhook">
          <el-input
            v-model="cfg.feishu.webhook"
            type="password"
            show-password
            placeholder="自定义机器人 Webhook（https://open.feishu.cn/open-apis/bot/v2/hook/…）"
          />
        </el-form-item>
        <el-form-item label="加签密钥">
          <el-input v-model="cfg.feishu.secret" type="password" show-password placeholder="安全设置选择「加签」时填写，否则留空" />
        </el-form-item>
      </el-form>
      <div class="ch-actions">
        <el-button size="small" :loading="testing.feishu" :disabled="!cfg.feishu.enabled" @click="test('feishu')">发送测试</el-button>
      </div>
    </div>

    <!-- 钉钉 -->
    <div class="block">
      <div class="block-title">
        <span>钉钉</span>
        <el-switch v-model="cfg.dingtalk.enabled" :disabled="!cfg.enabled" />
      </div>
      <el-form label-width="92px" class="form">
        <el-form-item label="Webhook">
          <el-input
            v-model="cfg.dingtalk.webhook"
            type="password"
            show-password
            placeholder="自定义机器人 Webhook（https://oapi.dingtalk.com/robot/send?access_token=…）"
          />
        </el-form-item>
        <el-form-item label="加签密钥">
          <el-input v-model="cfg.dingtalk.secret" type="password" show-password placeholder="安全设置勾选「加签」时必填（以 SEC 开头）" />
        </el-form-item>
      </el-form>
      <div class="ch-actions">
        <el-button size="small" :loading="testing.dingtalk" :disabled="!cfg.dingtalk.enabled" @click="test('dingtalk')">发送测试</el-button>
      </div>
    </div>

    <!-- 邮箱 -->
    <div class="block">
      <div class="block-title">
        <span>邮箱</span>
        <el-switch v-model="cfg.email.enabled" :disabled="!cfg.enabled" />
      </div>
      <el-form label-width="92px" class="form">
        <el-form-item label="SMTP 服务器">
          <el-input v-model="cfg.email.host" placeholder="如 smtp.qq.com / smtp.163.com / smtp.exmail.qq.com" />
        </el-form-item>
        <el-form-item label="端口">
          <el-input-number v-model="cfg.email.port" :min="1" :max="65535" />
          <el-checkbox v-model="cfg.email.secure" class="secure-check">SSL/TLS（465 勾选，587 不勾）</el-checkbox>
        </el-form-item>
        <el-form-item label="账号">
          <el-input v-model="cfg.email.username" placeholder="发件邮箱地址" />
        </el-form-item>
        <el-form-item label="授权码">
          <el-input v-model="cfg.email.password" type="password" show-password placeholder="SMTP 授权码（非邮箱登录密码）" />
        </el-form-item>
        <el-form-item label="发件人">
          <el-input v-model="cfg.email.from" placeholder="留空时使用账号；可写「名称 <邮箱>」" />
        </el-form-item>
        <el-form-item label="收件人">
          <el-input v-model="cfg.email.to" placeholder="多个收件人用逗号分隔" />
        </el-form-item>
      </el-form>
      <div class="ch-actions">
        <el-button size="small" :loading="testing.email" :disabled="!cfg.email.enabled" @click="test('email')">发送测试</el-button>
      </div>
    </div>

    <div class="form-actions">
      <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
      <span class="inline-hint">Webhook 地址、密钥与授权码将以系统密钥加密存储</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { NotifyChannelId, NotifyConfig } from '../../../types/notify'

const cfg = ref<NotifyConfig>(emptyConfig())
const saving = ref(false)
const testing = ref<Record<NotifyChannelId, boolean>>({
  system: false,
  wecom: false,
  feishu: false,
  dingtalk: false,
  email: false
})

function emptyConfig(): NotifyConfig {
  return {
    enabled: true,
    notifyOnSoon: true,
    notifyOnOverdue: true,
    system: { enabled: true },
    wecom: { enabled: false, webhook: '' },
    feishu: { enabled: false, webhook: '', secret: '' },
    dingtalk: { enabled: false, webhook: '', secret: '' },
    email: { enabled: false, host: '', port: 465, secure: true, username: '', password: '', from: '', to: '' }
  }
}

async function fetchConfig(): Promise<void> {
  const stored = (await window.api.notify.getConfig()) as Partial<NotifyConfig>
  cfg.value = { ...emptyConfig(), ...stored } as NotifyConfig
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await window.api.notify.saveConfig(JSON.parse(JSON.stringify(cfg.value)))
    ElMessage.success('配置已保存')
  } catch (err) {
    ElMessage.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    saving.value = false
  }
}

async function test(id: NotifyChannelId): Promise<void> {
  testing.value[id] = true
  try {
    await window.api.notify.testChannel(id, JSON.parse(JSON.stringify(cfg.value)))
    ElMessage.success('测试消息已发送，请查收')
  } catch (err) {
    ElMessage.error(`发送失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    testing.value[id] = false
  }
}

onMounted(fetchConfig)
</script>

<style scoped>
.block {
  margin-bottom: 22px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--divider);
}

.block:last-of-type {
  border-bottom: none;
}

.block-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin-bottom: 12px;
}

.form {
  max-width: min(560px, 100%);
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.switch-label {
  font-size: 13px;
}

.secure-check {
  margin-left: 12px;
}

.ch-actions {
  margin-top: 8px;
}

.inline-hint {
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.6;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}
</style>
