/**
 * IPC 传输前的响应式剥离。
 *
 * Vue 的 ref / reactive 会深层代理对象与数组，浅拷贝（{ ...obj } / [...arr]）只复制了
 * 外层，嵌套数组仍是 Proxy。Electron 的 IPC 用结构化克隆传输参数，遇到 Proxy 会抛
 * "An object could not be cloned."。所有要过 IPC 的业务对象都应先经过这里。
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
