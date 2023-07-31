
const app = getApp()
var util=require('../../utils/util'); 
Page({
    data: {
        system:'1000rem',
        theme:'100',
        mode:'200',
        id:'panel3',
        maxWord: 500,
        currentWord: 0
    },

      inputHandler(event) {
        this.setData({
          inputValue: event.detail.value || ''
        });
      },
      buttonHandler(event) {
        const newItem = this.data.inputValue.trim();
        if (!newItem) return;
        const itemArr = [...this.data.items, newItem];
        wx.setStorageSync('items', itemArr);
        this.setData({ items: itemArr });
      },

    /**
     * 生命周期函数--监听页面加载
     */
    onLoad:function (options) {
        wx.stopPullDownRefresh() 
        var that = this;
    setInterval(function(){
        that.setData({
            Time: util.formatTime(new Date())
        });    
    },1000);  
    const itemArr = wx.getStorageSync('items') || []; 
    this.setData({ items: itemArr });
        //刷新完成后停止下拉刷新动效
        //后面的业务代码大家自行发挥
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
    onPullDownRefresh:function () {
        var that = this;
    that.setData({
      currentTab: 0 //当前页的一些初始数据，视业务需求而定
    })
    this.onLoad();

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
    

//js文件
limitWord:function(e){
    var that = this;
    var value = e.detail.value;
    //解析字符串长度转换成整数。
    var wordLength = parseInt(value.length); 
    if (that.data.maxWord < wordLength) {
      return ;
    }
    that.setData({
      currentWord: wordLength 
    });
  },

})