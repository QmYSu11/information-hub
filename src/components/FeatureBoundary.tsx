import { Component } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { personal } from '../lib/personal-store';
export default class FeatureBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean; message: string }> {
  state = { failed: false, message: '' };
  static getDerivedStateFromError() { return { failed: true, message: '' }; }
  async reload() {
    await personal.flush();
    if (personal.getData() && document.querySelector('.notice-bar.warning')) {
      this.setState({ message: '当前还有未保存的资料，请先到设置导出备份。' }); return;
    }
    location.reload();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="empty-state"><div className="empty-icon"><RefreshCw /></div><h3>{this.props.name}暂时未能打开</h3><p>{this.state.message || '页面资源可能刚刚更新。保存个人资料后，刷新即可重新载入。'}</p><button className="button" onClick={() => void this.reload()}>保存并刷新 <RefreshCw size={14} /></button><a className="text-button" href="#/settings">前往备份与设置</a></div>;
  }
}
