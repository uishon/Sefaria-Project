{% autoescape off %}

'use strict';


let isChannelReady = false;
let isInitiator = false;
let isStarted = false;
let localStream;
let pc;
let remoteStream;
let pcConfig;

// Set up audio and video regardless of what devices are present.
const sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

/////////////////////////////////////////////

let clientRoom;

let chavrutaTime = 0;

const socket = io.connect('//{{ rtc_server }}');

socket.on('return rooms', function(numRooms) {
  console.log('got number of rooms')
  document.getElementById("numberOfChevrutas").innerHTML = numRooms;
});

socket.on('creds', function(conf) {
  console.log('got creds')
  pcConfig = conf;
});

socket.on('created', function(room) {
  console.log('Created room ' + room);
  isInitiator = true;
  clientRoom = room;

  // There is a situation where a client is in a room and another joins but a match not made & the other browser reloads
  // and sends the "bye" signal to the server and cleans up the room, but neither the join message nor the bye message
  // are received by the original client. This code runs every 7.5 seconds to make sure the room still exists and
  // prevents a user from getting stuck in a room that no one would join
  setInterval(function(){
    socket.emit('does room exist', clientRoom, {{ client_uid }});
    }, 7500);
});

socket.on('join', function(room) {
  console.log('user joined room: ' + room);
  clientRoom = room;
  isChannelReady = true;
  socket.emit('send user info', '{{ client_name }}', '{{ client_uid }}', room);
  maybeStart();
});

socket.on('got user name', function(userName, uid) {
  console.log('got user name')
  Sefaria.track.event("DafRoulette", "Chevruta Match Made");
  document.getElementById("chevrutaName").innerHTML = userName;
  document.getElementById("chevrutaUID").value = uid;
  localStorage.setItem('lastChevrutaID', uid);
  localStorage.setItem('lastChevrutaTimeStamp', Date.now());

  setInterval(function(){
    chavrutaTime = chavrutaTime + 1
  }, 60000);
});

socket.on('user reported', function(){
  remoteVideo.srcObject = null;
  document.getElementById("reportUser").remove();
  alert("Your chevruta clicked the 'Report User' button. \n\nA report has been sent to the Sefaria administrators.")
});

socket.on('byeReceived', function(){
  console.log('bye received')

  window.onbeforeunload = null;
  location.reload();
});



////////////////////////////////////////////////

function sendMessage(message) {
  console.log('Client sending message: ', message);
  console.log(clientRoom)
  socket.emit('message', message, clientRoom);
}

// This client receives a message
socket.on('message', function(message) {
  console.log('Client received message:', message);
  if (message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      maybeStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    const candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    pc.addIceCandidate(candidate);
  } else if (message === 'bye') {
    handleRemoteHangup();
  }
});

socket.on('room full', function() {
  alert("The room you selected is full. Please try again later.")
})

////////////////////////////////////////////////////

const localVideo = document.querySelector('#localVideo');
const remoteVideo = document.querySelector('#remoteVideo');

navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
  })
  .then((stream) => {
    localStream = localVideo.srcObject = stream;

    // if it's been >5 minutes since user last matched w/ a chevruta allow for any potential match
    if (Date.now() - localStorage.getItem('lastChevrutaTimeStamp') > 300000) {
      localStorage.setItem('lastChevrutaID', null);
    }

    if (startingRoom !="" && {{roulette}} == 0 ) {
      socket.emit('start chevruta', {{ client_uid }}, startingRoom);
    }
    else {
      socket.emit('start roulette', {{ client_uid }}, localStorage.getItem('lastChevrutaID'), startingRoom == "" ? "dafRoulette" : startingRoom);
    }
    console.log('Adding local stream.');
  })
  .catch(function(e) {
    alert("There was an error starting your video. Usually this is because your camera is being used by another program. Please check and try again.");
  });

function addAdditionalHTML() {

  if ({{roulette}} == "1") {
    const newRoomButton = document.createElement('div');
    newRoomButton.innerHTML = '<button id="newRoom" onclick="getNewChevruta()"><span class="int-en">New Person</span><span class="int-he">משתמש חדש</span></button>';
    document.getElementById("buttonContainer").appendChild(newRoomButton)
  }

  document.body.classList.remove("hasBannerMessage");

  const iframe = document.createElement('iframe');
  iframe.src = "https://www.sefaria.org/"+startingRef;
  document.getElementById("iframeContainer").appendChild(iframe);
}

function getNewChevruta() {
  Sefaria.track.event("DafRoulette", "New Chevruta Click", "");
  byebye();
}


function toggleMute() {
  localStream.getAudioTracks()[0].enabled = !(localStream.getAudioTracks()[0].enabled);

  const videoDiv = document.getElementById("videos");
  if(videoDiv.classList.contains("muted")) {
    videoDiv.classList.remove("muted");
    document.getElementById("enMute").setAttribute("title", "Turn off microphone");
    document.getElementById("heMute").setAttribute("title", "כבה את המיקרופון");
  }
  else {
    videoDiv.classList.add("muted")
    document.getElementById("enMute").setAttribute("title", "Turn on microphone");
    document.getElementById("heMute").setAttribute("title", "הפעל את המיקרופון");
  }
}

function reportUser() {
  remoteVideo.srcObject = null;
  socket.emit('report user', clientRoom)

  const uid = document.getElementById("chevrutaUID").value;
  const username = document.getElementById("chevrutaName").innerHTML;

  var feedback = {
      type: "daf_roulette_report",
      msg: `{{client_name}} ({{client_uid}}) reported ${username} (${uid}) on DafRoulette`,
      uid: {{client_uid}} || null,
      url: "/daf-roulette",
  };
  var postData = {json: JSON.stringify(feedback)};
  var url = "/api/send_feedback";

  $.post(url, postData, function (data) {
      if (data.error) {
          alert(data.error);
      } else {
          console.log(data);
          window.onbeforeunload = null;
          alert(`We're sorry you had this experience. ${username} has been reported to the Sefaria administrators.`)
          location.reload()
      }
  }.bind(this)).fail(function (xhr, textStatus, errorThrown) {
      alert(Sefaria._("Unfortunately, there was an error sending this feedback. Please try again or try reloading this page."));
  });
}

function maybeStart() {
  console.log('maybeStart() ', isStarted, localStream, isChannelReady);
  if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
    createPeerConnection();
    pc.addStream(localStream);
    isStarted = true;
    if (isInitiator) {
      doCall();
    }
  }
}

window.onbeforeunload = function() {
  console.log('onbeforeunload')
  byebye();
};

/////////////////////////////////////////////////////////

function createPeerConnection() {
  console.log('creating peer connection')
  try {
    if (location.hostname !== 'localhost') {
      pc = new RTCPeerConnection(pcConfig);
    } else {
      pc = new RTCPeerConnection(null);
    }
    pc.onicecandidate = handleIceCandidate;
    pc.onaddstream = handleRemoteStreamAdded;
    pc.onremovestream = handleRemoteStreamRemoved;
    pc.oniceconnectionstatechange = handleIceConnectionChange;
    console.log('Created RTCPeerConnnection');

    //in certain circumstances a user can join a room and await a connection from a user that doesn't exist
    //five seconds should be more than enough to move from "new" to "checking" or "connected"
    setTimeout(function(){
      console.log('checking not in phantom room')
        if (isStarted && !isInitiator && pc.iceConnectionState == "new") {
          byebye();
        }
    }, 5000);

  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function handleIceCandidate(event) {
  // console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    });
  } else {
    console.log('End of candidates.');

    //in certain circumstances no legit icecandidate's can be found or a remotestream never added
    //three seconds after running through all candidates should be more than enough to ascertain
    setTimeout(function(){
      console.log('checking if remote stream exists')
      if (!remoteStream) {
        byebye();
      }
    }, 3000);
  }
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doCall() {
  console.log('Sending offer to peer');
  pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer().then(
    setLocalAndSendMessage,
    onCreateSessionDescriptionError
  );
}

function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  // console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription);
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  remoteStream = event.stream;
  remoteVideo.srcObject = remoteStream;
  document.getElementById("chevrutaName").style.display = 'block';
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function handleIceConnectionChange(event) {
  if (pc.iceConnectionState == "failed") {
    byebye();
  }
  //"disconnected" could be a temporary state caused by any number of factors that could be automatically fixed w/o intervention
  // this gives the app a chance to re-establish the connection before restarting
  else if(pc.iceConnectionState == "disconnected") {
        console.log("iceConnection is disconnected -- waiting 5 seconds to see if reconnects")
        setTimeout(function(){
        if (pc.iceConnectionState == "disconnected") {
          byebye();
        }
    }, 5000);
  }
  console.log(pc.iceConnectionState);
}

function handleRemoteHangup() {
  Sefaria.track.event("DafRoulette", "Chevruta Ended", "Minutes Learned", chavrutaTime);
  window.onbeforeunload = null;
  location.reload();
}

function byebye(){
    Sefaria.track.event("DafRoulette", "Chevruta Ended", "Minutes Learned", chavrutaTime);
    socket.emit('bye', clientRoom);
}


{% endautoescape %}
