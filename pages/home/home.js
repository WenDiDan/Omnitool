const app = getApp()
var util=require('../../utils/util')

Page({
  data: {
    records: [],
    rec:app.globalData.rec,
    result:'',
    maxWord:'',
    Leng:'',
    color1:'#3cff2a'
  },

  bindViewTap() {
    wx.navigateTo({
      url: '../logs/logs'
    })
  },
  onLoad() {
    if (wx.getUserProfile) {
      this.setData({
        canIUseGetUserProfile: true
      })
    }
  },
  takePhoto() {
    const ctx = wx.createCameraContext()
    ctx.takePhoto({
        quality: 'high',
        success: (res) => {
            this.setData({
                src: res.tempImagePath
            })
        }
    })
  },
 scanCode(event) {
        var myThis = this;   
        const that = this;
        wx.scanCode({
            onlyFromCamera:false,
            scanType:['barCode', 'qrCode','datamatrix','pdf417'],
          success(res) {
            myThis.setData({
              result: res.result,
             inputValue:res.result,
              scanType: res.scanType+'码',
            })

            that.buttonHandler() 
            }
            
        });


                  
    },

     
error(e) {
    console.log(e.detail)
  },

//  inputHandler(event) {
//     this.setData({
//       inputValue:''
//     });
//   },
buttonHandler(event) {
    if ( this.data.inputValue==null){
        console.log('空数据');
    }
    else {
    const newItem = this.data.inputValue.trim();
    if (!newItem) return;
    const itemArr = [...this.data.records, newItem];
    wx.setStorageSync('records', itemArr);
    this.setData({ records: itemArr },
        // function(){
        //     wx.showToast({
        //       title: '操作完成',
        //     })
        // }
        );
        console.log('数据存储成功');
    }
},
clear1(event){
    const that = this;
    wx.showModal({
     title: '操作确认',
     content: '你确认要清楚吗？',
     success (res) {      
       if (res.confirm) {
       wx.removeStorageSync('records')
       wx.removeStorageSync('items')
       wx.showToast({title: '操作完成',duration: 700})
       that.onLoad()
       }
       
      else if (res.cancel) {
         console.log('用户点击取消');
       };
     }
   })
 },
clear:function(){
  wx.removeStorageSync('records')
    wx.showToast({
    title: '操作完成',
    duration: 700
      })
    this.onLoad()
  // wx.showToast({
      // title: '退出登录成功',
      // icon: 'none',
     //  duration: 2000,
      // success: function () {
         // setTimeout(function () {
             //跳转到首页，强制重启
            // wx.reLaunch({
              //  url: '/pages/index/index',
           //  })//
        //  }, 2000);
       //}
   // })
},
onLoad:function (options) {
    wx.stopPullDownRefresh() 
    var that = this;
    setInterval(function(){
    that.setData({
        Time: util.formatTime(new Date())
    });    
    },1000);  
    const itemArr = wx.getStorageSync('records') || []; 
    this.setData({
        records: itemArr,
    });
  },
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
    })
}


})