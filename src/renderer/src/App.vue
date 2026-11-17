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
        <span class="brand-mark">⚡</span>
        <span class="brand-name">myDash</span>
      </div>
      <el-menu
        class="topmenu"
        mode="horizontal"
        router
        :default-active="route.path"
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
          <component :is="Component" />
        </transition>
      </router-view>
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Box, Document, Odometer, Setting, SetUp } from '@element-plus/icons-vue'
import { pluginRegistry } from './plugins/store'

const route = useRoute()
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

.brand-mark {
  font-size: 20px;
  filter: drop-shadow(0 0 8px var(--accent-border));
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

/* 路由切换动效 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
