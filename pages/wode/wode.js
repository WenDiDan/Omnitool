
Page({

    /**
     * 页面的初始数据
     */
    data: {
        rec:''

    },

    /**
     * 生命周期函数--监听页面加载
     */
    onLoad(options) {

    },

    /**
     * 生命周期函数--监听页面初次渲染完成
     */
    onReady() {

    },

    /**
     * 生命周期函数--监听页面显示
     */
    onShow() {

    },

    /**
     * 生命周期函数--监听页面隐藏
     */
    onHide() {

    },

    /**
     * 生命周期函数--监听页面卸载
     */
    onUnload() {

    },

    /**
     * 页面相关事件处理函数--监听用户下拉动作
     */
    onPullDownRefresh() {

    },

    /**
     * 页面上拉触底事件的处理函数
     */
    onReachBottom() {

    },

    /**
     * 用户点击右上角分享
     */
    onShareAppMessage() {

    },

  //显示模块对话框
  nameup: function() {
    this.setData({
      showModal: true
    })
  },
  //隐藏模块对话框
  hideModal: function() {
   this.setData({
      showModal: false
    });
  },
  // 对话框取消按钮点击事件
  onCancelname: function() {
    this.hideModal();
  },
   // 输入框内容改变事件
  inputChangename: function(e) {
    this.setData({
      rec: e.detail.value
    })
  },
  //  对话框确认按钮点击事件
  onConfirmname: function() {
    var that = this;  
    
          wx.showToast({
            title: '修改成功',
            icon: 'success'
          })
          that.hideModal();
    
        
      },
})