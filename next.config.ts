import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 放行局域网 IP 访问 dev server(手机真机调试用)。
  // Next.js 16 默认拒绝非 localhost 来源的开发请求,不加这行的话
  // 手机上打开页面 JS 无法激活(按钮全部失效、输入不生效)。
  // 注意:电脑 IP 变了(换Wi-Fi等)需要同步改这里并重启 dev server。
  allowedDevOrigins: ["192.168.100.33"],
};

export default nextConfig;
