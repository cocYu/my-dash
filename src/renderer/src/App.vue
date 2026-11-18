<template>
  <el-container class="layout" direction="vertical">
    <!-- 暮色极光背景（玻璃面板的采样源） -->
    <div class="aurora" aria-hidden="true">
      <span class="a1" />
      <span class="a2" />
      <span class="a3" />
    </div>

    <el-header class="header glass" height="58px">
      <div class="brand">
        <img class="brand-mark" :src="logoUrl" alt="AtoZ logo" />
        <span class="brand-name">AtoZ</span>
      </div>
      <el-menu
        class="topmenu"
        mode="horizontal"
        router
        :default-active="menuActive"
        :ellipsis="true"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon>
          <span>仪表盘</span>
        </el-menu-item>
        <el-menu-item index="/notes">
          <el-icon><Document /></el-icon>
          <span>笔记</span>
        </el-menu-item>
        <el-menu-item index="/todos">
          <el-icon><Finished /></el-icon>
          <span>待办</span>
        </el-menu-item>
        <el-menu-item index="/toolbox">
          <el-icon><Suitcase /></el-icon>
          <span>工具箱</span>
        </el-menu-item>
        <el-menu-item index="/ai">
          <el-icon><MagicStick /></el-icon>
          <span>AI 工作台</span>
        </el-menu-item>
        <!-- 插件注册的页面 -->
        <el-menu-item v-for="page in pluginRegistry.pages" :key="page.path" :index="page.path">
          <el-icon><component :is="page.icon ?? SetUp" /></el-icon>
          <span>{{ page.title }}</span>
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <span>设置</span>
        </el-menu-item>
      </el-menu>
    </el-header>

    <el-main class="main">
      <router-view v-slot="{ Component }">
        <transition name="fade-slide" mode="out-in">
          <!-- keep-alive 缓存各页面实例：顶部菜单切回时免重挂载/重拉数据/重建编辑器 -->
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </transition>
      </router-view>
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Box, Document, Finished, MagicStick, Odometer, Setting, SetUp, Suitcase } from '@element-plus/icons-vue'
import logoUrl from './assets/logo.png'
import { pluginRegistry } from './plugins/store'

const route = useRoute()

// /toolbox/:toolId 深链时菜单仍高亮「工具箱」主项
const menuActive = computed(() => (route.path.startsWith('/toolbox') ? '/toolbox' : route.path))
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  overflow: hidden;
}
</style>

<style scoped>
.layout {
  height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  gap: 26px;
  margin: 14px 14px 0;
  padding: 0 20px;
  border-radius: 16px;
  z-index: 1;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}

/* 品牌 logo：浅色衬底小徽章，深浅主题下都清晰 */
.brand-mark {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  padding: 2px;
  background: linear-gradient(135deg, #fffdf8, #ffefd8);
  box-shadow:
    inset 0 0 0 1px rgba(30, 42, 66, 0.1),
    0 1px 4px rgba(30, 42, 66, 0.14);
}

.brand-name {
  font-family: 'Outfit', sans-serif;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: linear-gradient(100deg, var(--brand-from) 30%, var(--brand-to));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.topmenu {
  flex: 1;
  min-width: 0;
}

.main {
  height: calc(100vh - 72px);
  overflow-y: auto;
  padding: 20px 18px 24px;
}

/* 路由切换动效（短促轻移：out-in 串行总时长 = 两段之和，压短到 100ms/段） */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
