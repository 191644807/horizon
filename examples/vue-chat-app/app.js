'use strict'

const Fusion = require('Fusion')
const fusion = new Fusion(location.host, {
  secure: location.protocol == 'http:'
})
const chat = fusion('chat')
const app = new Vue({

  el: '#app',
  data: {
    newMessage: '',
    avatar_url: `http://api.adorable.io/avatars/50/${new Date().getMilliseconds()}.png`,
    messages: [],
  },

  computed: {

    limitedMessages: function() {
      this.messages.sort(function(a, b) {
        if (a.id > b.id) {
          return 1
        } else {
          return -1
        }
      });

      return this.messages.slice(-8)
    },


  },

  methods: {
    addMessage: function() {
      var text = this.newMessage.trim();
      if (text) {
        chat.store({
          text: text,
          id: new Date(),
          url: this.avatar_url,
        });
        this.newMessage = '';
      }
    },

    addedChange: function(newDoc) {
      // Parse string as proper Date Object
      this.messages.push(newDoc);
      console.log(this.messages);
    },

  },
});
chat.order('id', 'ascending').subscribe({
  onAdded: app.addedChange,
});

// Image preloading
const image = new Image();
image.src = app.avatar_url;
