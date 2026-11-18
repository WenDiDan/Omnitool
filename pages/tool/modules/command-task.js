/**
 * 互助工具 · 口令与任务
 *
 * 口令编辑/复制/抽取、任务倒计时与状态回报、黑名单。
 * 通过 Object.assign 合并进 Page，this 指向页面实例。
 */

const Toast = require('tdesign-miniprogram/toast/index').default;
const Dialog = require('tdesign-miniprogram/dialog/index').default;

const TASK_SECONDS_DEFAULT = 300; // 任务有效期兜底 5 分钟，实际以工具配置 task_seconds 为准
const BLOCK_KEY = 'toolBlockList';

module.exports = {
  editCommand() {
    const current = this.data.current;
    const mode = this.data.activeMode === 0 ? 'solo' : 'team';

    wx.showModal({
      title: `${current.label} · 我的口令`,
      editable: true,
      placeholderText: '粘贴淘口令或助力链接',
      content: current.command || '',
      success: (res) => {
        if (!res.confirm) return;
        const command = String(res.content || '').trim().slice(0, 500);

        wx.showLoading({ title: '保存中', mask: true });
        wx.cloud.callFunction({
          name: 'coinPkApi',
          data: {
            action: 'saveCommand',
            tool_key: this.modeStateKey(),
            mode,
            command
          },
          success: (r) => {
            const result = r && r.result;
            if (this.handleBlocked(result)) {
              wx.hideLoading();
              return;
            }
            if (!result || !result.success) {
              if (result && result.error === 'NOT_REGISTERED') {
                wx.hideLoading();
                this.promptRegister();
                return;
              }
              if (result && result.error === 'INVALID_COMMAND') {
                Toast({ context: this, selector: '#t-toast', message: '口令太短，至少 5 个字符' });
                return;
              }
              if (result && result.error === 'BUSY') {
                Toast({ context: this, selector: '#t-toast', message: '口令正被助力，请稍后再改' });
                return;
              }
              if (result && result.error === 'NEED_HELP_FIRST') {
                wx.hideLoading();
                const lack = Math.max(1, 1 - (typeof result.quota === 'number' ? result.quota : 0));
                Dialog.confirm({
                  context: this,
                  selector: '#t-dialog',
                  title: '先助力，再发布',
                  content: `你的受助机会余额为 ${result.quota} 次，还差 ${lack} 次才能发布口令。\n规则：注册即赠 1 次，成功助力他人 +1 次，被他人助力 -1 次；不按天补充，亏欠会原样结转到次日，需继续助力补齐。`,
                  confirmBtn: '去助力',
                  cancelBtn: '知道了'
                }).then(() => {
                  this.switchTab({ currentTarget: { dataset: { index: 0 } } });
                }).catch(() => {});
                return;
              }
              Toast({ context: this, selector: '#t-toast', message: '保存失败，请重试' });
              return;
            }
            this.updateMode({ command: result.command }, this.data.activeMode);
            this._lastCommandDate = result.date || this.localDateKey();
            Toast({ context: this, selector: '#t-toast', message: command ? '口令已更新' : '口令已清空', theme: 'success' });
          },
          fail: () => {
            Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' });
          },
          complete: () => wx.hideLoading()
        });
      }
    });
  },

  /** 复制当前助力模式的口令 */
  copyCommand() {
    const command = this.data.current.command;
    if (!command) {
      Toast({ context: this, selector: '#t-toast', message: '尚未设置口令' });
      return;
    }
    wx.setClipboardData({
      data: command,
      success: () => Toast({ context: this, selector: '#t-toast', message: '口令已复制', theme: 'success' })
    });
  },

  /** 领取口令：从云端口令池抽一条非本人的口令；匹配成功才扣次数 */
  drawCommand(swapsLeft, extraExclude) {
    if (this.data.drawing) return;
    const state = this._modeStates[this.data.activeMode];
    if (!state) return;
    if (state.task) {
      Toast({ context: this, selector: '#t-toast', message: '已有进行中的任务' });
      return;
    }
    if (state.helpLeft !== undefined && state.helpLimit - state.helpUsed <= 0) {
      Toast({ context: this, selector: '#t-toast', message: '今日助人次数已用完' });
      return;
    }

    this.setData({ drawing: true });
    const mode = this.data.activeMode === 0 ? 'solo' : 'team';
    const exclude = this.getBlockList();
    if (extraExclude) exclude.push(extraExclude);
    wx.cloud.callFunction({
      name: 'coinPkApi',
      data: {
        action: 'drawCommand',
        tool_key: this.modeStateKey(),
        mode,
        exclude_nicks: exclude
      },
      success: (r) => {
        const result = r && r.result;
        if (this.handleBlocked(result)) {
          this.setData({ drawing: false });
          return;
        }
        if (!result || !result.success) {
          if (result && result.error === 'NOT_REGISTERED') {
            this.promptRegister();
            return;
          }
          if (result && result.error === 'LIMIT_REACHED') {
            Toast({ context: this, selector: '#t-toast', message: '今日助人次数已用完' });
            this.loadCommands();
            return;
          }
          Toast({ context: this, selector: '#t-toast', message: '领取失败，请重试' });
          return;
        }
        if (!result.matched) {
          // 空池：没设口令的人先发布口令，池子才会有人可被助力
          const hasCommand = !!(this.data.current && this.data.current.command);
          if (!hasCommand) {
            Dialog.confirm({
              context: this,
              selector: '#t-dialog',
              title: '暂时没有可匹配的口令',
              content: '你还没有设置自己的口令。先发布口令让别人助力你，同时也会增加口令池供给，更容易匹配到人。',
              confirmBtn: '去设置',
              cancelBtn: '稍后'
            }).then(() => {
              this.editCommand();
            }).catch(() => {});
          } else {
            Toast({ context: this, selector: '#t-toast', message: '暂无匹配，不扣次数' });
          }
          return;
        }

        const t = result.task;
        this.updateMode({
          helpUsed: state.helpUsed + 1,
          task: {
            taskId: t.task_id,
            command: t.command,
            nick: t.nick,
            avatar_url: t.avatar_url,
            avatarText: (t.nick || '淘').charAt(0),
            swapsLeft: typeof swapsLeft === 'number' ? swapsLeft : 3,
            deadline: Date.now() + ((this.data.tool && this.data.tool.task_seconds) || TASK_SECONDS_DEFAULT) * 1000
          }
        }, this.data.activeMode);
        this.startTaskTimer();
        this.loadCommands();
      },
      fail: () => Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' }),
      complete: () => this.setData({ drawing: false })
    });
  },

  /** 启动任务倒计时（5:00），超时自动释放并退回次数 */
  startTaskTimer() {
    this.stopTaskTimer();
    const tick = () => {
      const state = this._modeStates[this.data.activeMode];
      const task = state && state.task;
      if (!task) { this.stopTaskTimer(); return; }
      const left = Math.max(0, Math.round((task.deadline - Date.now()) / 1000));
      const mm = String(Math.floor(left / 60)).padStart(2, '0');
      const ss = String(left % 60).padStart(2, '0');
      this.setData({ taskCountdown: `${mm}:${ss}` });
      if (left <= 0) {
        this.stopTaskTimer();
        this.releaseTask('任务已超时释放，次数已退回');
      }
    };
    tick();
    this._taskTimer = setInterval(tick, 1000);
  },

  stopTaskTimer() {
    if (this._taskTimer) {
      clearInterval(this._taskTimer);
      this._taskTimer = null;
    }
  },

  /** 回报口令状态：done 永久出池；available 退回池中。失败静默（云端有超时兜底） */
  notifyCommandStatus(taskId, status, proofFileId) {
    if (!taskId) return;
    wx.cloud.callFunction({
      name: 'coinPkApi',
      data: {
        action: 'updateCommandStatus',
        task_id: taskId,
        status,
        proof_file_id: proofFileId || ''
      },
      fail: () => { /* 云端 6 分钟后自动兜底释放 */ }
    });
  },

  /** 释放当前任务：退回助人次数并清除任务（口令退回池中） */
  releaseTask(toast) {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    this.stopTaskTimer();
    this.notifyCommandStatus(state.task.taskId, 'available');
    this.updateMode({
      helpUsed: Math.max(0, state.helpUsed - 1),
      task: null
    }, this.data.activeMode);
    this.setData({ taskCountdown: '' });
    if (toast) Toast({ context: this, selector: '#t-toast', message: toast });
  },

  /** 换一个：释放当前任务并重新领取（每日限 3 次） */
  swapTask() {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    if (state.task.swapsLeft <= 0) {
      Toast({ context: this, selector: '#t-toast', message: '换的次数已用完，请完成或反馈失败' });
      return;
    }
    const nick = state.task.nick;
    const swapsLeft = state.task.swapsLeft - 1;
    const taskId = state.task.taskId;
    this.stopTaskTimer();
    this.notifyCommandStatus(taskId, 'available');
    this.updateMode({
      helpUsed: Math.max(0, state.helpUsed - 1),
      task: null
    }, this.data.activeMode);
    this.setData({ taskCountdown: '', drawing: false }, () => {
      this.drawCommand(swapsLeft, nick);
    });
  },

  /** 拉黑：不再匹配该昵称，并自动换下一个 */
  blockTask() {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    const nick = state.task.nick;
    const swapsLeft = state.task.swapsLeft;
    const taskId = state.task.taskId;
    this.addBlockNick(nick);
    this.stopTaskTimer();
    this.notifyCommandStatus(taskId, 'available');
    this.updateMode({
      helpUsed: Math.max(0, state.helpUsed - 1),
      task: null
    }, this.data.activeMode);
    this.setData({ taskCountdown: '', drawing: false }, () => {
      this.drawCommand(swapsLeft, nick);
    });
  },

  /** 反馈失败：退回次数并释放任务 */
  reportFail() {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    this.releaseTask('已反馈失败，次数已退回');
  },

  /** 提交助力结果（进入待核对）：车队必须先上传截图，个人赛直接提交 */
  markSuccess() {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    if (this.data.activeMode === 1) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
          if (!filePath) return;
          wx.showLoading({ title: '上传截图中', mask: true });
          const cloudPath = `help_proofs/${this.modeStateKey()}/${Date.now()}-${Math.floor(Math.random() * 1000000)}.jpg`;
          wx.cloud.uploadFile({
            cloudPath,
            filePath,
            success: (up) => this.doMarkSuccess(up.fileID),
            fail: () => {
              wx.hideLoading();
              Toast({ context: this, selector: '#t-toast', message: '截图上传失败，请重试' });
            }
          });
        },
        fail: () => { /* 用户取消选择 */ }
      });
      return;
    }
    this.doMarkSuccess('');
  },

  doMarkSuccess(proofFileId) {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    const taskId = state.task.taskId;
    this.stopTaskTimer();
    // 提交后进入待核对：对方确认或 10 分钟自动通过才算完成
    this.notifyCommandStatus(taskId, 'submitted', proofFileId);

    this.updateMode({ task: null }, this.data.activeMode);
    this.setData({ taskCountdown: '' });
    this.loadCommands();
    Toast({ context: this, selector: '#t-toast', message: '已提交，等待对方核对' });
  },

  /** 受助方确认完成：待核对 → 已成功（受助次数此时才 +1） */
  confirmReceive(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showLoading({ title: '确认中', mask: true });
    wx.cloud.callFunction({
      name: 'coinPkApi',
      data: { action: 'confirmReceive', tool_key: this.modeStateKey(), task_id: id },
      success: (r) => {
        const result = r && r.result;
        if (result && result.success) {
          Toast({ context: this, selector: '#t-toast', message: '已确认完成', theme: 'success' });
          this.loadRecords();
          this.loadCommands();
        } else {
          Toast({ context: this, selector: '#t-toast', message: '确认失败，请重试' });
        }
      },
      fail: () => Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' }),
      complete: () => wx.hideLoading()
    });
  },

  /** 复制任务口令 */
  copyTaskCommand() {
    const state = this._modeStates[this.data.activeMode];
    const command = state && state.task && state.task.command;
    if (!command) return;
    wx.setClipboardData({
      data: command,
      success: () => Toast({ context: this, selector: '#t-toast', message: '口令已复制', theme: 'success' })
    });
  },

  /** 黑名单（按工具分组，本地存储） */
  getBlockList() {
    try {
      const all = wx.getStorageSync(BLOCK_KEY) || {};
      return all[this.modeStateKey()] || [];
    } catch (e) { return []; }
  },

  addBlockNick(nick) {
    if (!nick) return;
    try {
      const all = wx.getStorageSync(BLOCK_KEY) || {};
      const key = this.modeStateKey();
      const list = all[key] || [];
      if (list.indexOf(nick) === -1) list.push(nick);
      all[key] = list;
      wx.setStorageSync(BLOCK_KEY, all);
    } catch (e) { /* 忽略 */ }
  },

};
