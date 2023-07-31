
var types = ['default', 'primary', 'warn']
var pageObject = {
  data: {
    defaultSize: 'default',
    primarySize: 'default',
    warnSize: 'default',
    disabled: false,
    plain: false,
    loading: false
  },
  setDisabled: function (e) {
    this.setData({
      disabled: !this.data.disabled
    })
  },
  setPlain: function (e) {
    this.setData({
      plain: !this.data.plain
    })
  },
  setLoading: function (e) {
    this.setData({
      loading: !this.data.loading
    })
  },
  onGotUserInfo: function (e) {
    console.log(e.detail.errMsg)
    console.log(e.detail.userInfo)
    console.log(e.detail.rawData)
  },
}

for (var i = 0; i < types.length; ++i) {
  (function (type) {
    pageObject[type] = function (e) {
      var key = type + 'Size'
      var changedData = {}
      changedData[key] =
        this.data[key] === 'default' ? 'mini' : 'default'
      this.setData(changedData)
    }
  })(types[i])
}
Page(pageObject,
    {
        /*** 页面的初始数据*/
        data: {},
        /** 生命周期函数--监听页面加载*/
        onLoad(options) { },
        /*** 生命周期函数--监听页面初次渲染完成*/
        onReady() {},
        /*** 生命周期函数--监听页面显示*/
        onShow() {},
        /*** 生命周期函数--监听页面隐藏*/
        onHide() {},
        /*** 生命周期函数--监听页面卸载*/
        onUnload() {},
        /*** 页面相关事件处理函数--监听用户下拉动作*/
        onPullDownRefresh() {},
        /*** 页面上拉触底事件的处理函数*/
        onReachBottom() {},
        /*用户点击右上角分享 */
        onShareAppMessage() {},
    
    })