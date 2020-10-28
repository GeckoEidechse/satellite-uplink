// Escape text for embedding into HTML code
var escapeHtml = require('escape-html');

// ========================================

const express = require("express");
const path = require("path");

const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const PORT = 8000;

// Store map from user to ordnance
var user_to_ordnance = new Map();
var user_to_titan = new Map();

// ========================================

require('dotenv').config();
const Discord = require('discord.js');
const bot = new Discord.Client();
const TOKEN = process.env.TOKEN;

// Globally available channel IDs
const GLOBAL_CHANNEL_ID_WAITING = process.env.GLOBAL_CHANNEL_ID_WAITING;
const GLOBAL_CHANNEL_ID_MILITA = process.env.GLOBAL_CHANNEL_ID_MILITA;
const GLOBAL_CHANNEL_ID_IMC = process.env.GLOBAL_CHANNEL_ID_IMC;

bot.login(TOKEN);

// ========================================

/**
 * Webserver part
 */
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.get('/', (req, res, next) => {
  res.render('index');
});

io.on('connection', (socket) => {
  console.log("a user connected via socket!");
  socket.on('disconnect', () => {
    console.log("a user disconnected");
  });


  socket.on('update ordnance', function (ordnance_update) {
    console.debug("Received data:");
    console.debug(ordnance_update);
    user_to_ordnance.set(ordnance_update.user_id, ordnance_update.ordnance);
    console.debug(user_to_ordnance);
    // send update back
    send_selection_update_to_clients();
  });

  socket.on('update titan', function (titan_update) {
    console.debug("Received data:");
    console.debug(titan_update);
    user_to_titan.set(titan_update.user_id, titan_update.titan);
    console.debug(user_to_titan);
    // send update back
    send_selection_update_to_clients();
  });

  socket.on('new client', function () {
    // Update if a new client joins
    send_full_update_to_clients(); // TODO update only for new client
  });
});
server.listen(PORT, () => {
  console.log("Server listening on port: " + PORT)
});

/**
 * Discord Obeserver Bot part
 */
bot.on('ready', () => {
  console.info(`Logged in as ${bot.user.tag}!`);
});

bot.on('message', msg => {
  // Do nothing on msg
});

function send_full_update_to_clients() {
  let channel_waiting = bot.channels.cache.get(GLOBAL_CHANNEL_ID_WAITING);
  let channel_Milita = bot.channels.cache.get(GLOBAL_CHANNEL_ID_MILITA);
  let channel_IMC = bot.channels.cache.get(GLOBAL_CHANNEL_ID_IMC);

  send_users_in_all_channels(channel_waiting, channel_Milita, channel_IMC);
}

function send_selection_update_to_clients() {
  let channel_waiting = bot.channels.cache.get(GLOBAL_CHANNEL_ID_WAITING);
  let channel_Milita = bot.channels.cache.get(GLOBAL_CHANNEL_ID_MILITA);
  let channel_IMC = bot.channels.cache.get(GLOBAL_CHANNEL_ID_IMC);

  send_current_selections(channel_waiting, channel_Milita, channel_IMC);
}

function get_users_in_channel(channel) {
  var user_list = [];

  for (const member of channel.members) {
    // member[0] -> user id
    // member[1] -> `GuildMember` object

    // Initiate user
    var current_user = { id: member[0], name: null, avatar: member[1].user.avatar };

    if (member[1].nickname !== null) {
      // Prefer nickname if user has one...
      current_user.name = member[1].nickname;
    } else {
      // ...otherwise use their username
      current_user.name = member[1].user.username;
    }
    // Escape any html in username
    current_user.name = escapeHtml(current_user.name);
    // Add to list
    user_list.push(current_user)
  }
  return user_list;
}

function get_all_users_in_channels(list_of_channels) {
  all_users = new Array();
  for (channel of list_of_channels) {
    let users_of_channel = get_users_in_channel(channel);
    for (user of users_of_channel) {
      all_users.push(user);
    }
  }
  return all_users;
}

function get_set_of_user_ids(users) {
  var set_of_user_ids = new Set();
  for (user of users) {
    set_of_user_ids.add(user.id);
  }
  return set_of_user_ids;
}

function send_users_in_all_channels(channel_lobby, channel_a, channel_b) {

  var channel_tree_object = {
    channel_lobby: {
      name: channel_lobby.name,
      users: get_users_in_channel(channel_lobby)
    },
    channel_a: {
      name: channel_a.name,
      users: get_users_in_channel(channel_a)
    },
    channel_b: {
      name: channel_b.name,
      users: get_users_in_channel(channel_b)
    },
  }
  // Remove selection if user switches to lobby/waiting
  for (user of channel_tree_object.channel_lobby.users) {
    console.log("Removing user due to being in lobby:", user.id);
    user_to_ordnance.delete(user.id);
    user_to_titan.delete(user.id);
  }

  // Remove selection if user is no longer present
  // Get all users...
  let set_of_user_ids = get_set_of_user_ids(get_all_users_in_channels([channel_lobby, channel_a, channel_b]));
  // ...and remove inactive from mappings
  remove_inactive_from_mapping(user_to_ordnance, set_of_user_ids);
  remove_inactive_from_mapping(user_to_titan, set_of_user_ids);

  // Convert to string as we cannot send Maps via socket.io
  let user_to_ordnance_string = JSON.stringify(Array.from(user_to_ordnance));
  let user_to_titan_string = JSON.stringify(Array.from(user_to_titan));

  // Send message
  io.emit('update channel tree', channel_tree_object, user_to_ordnance_string, user_to_titan_string);

  return;
}

// TODO a lot of code here is duplicated from `send_users_in_all_channels`
// Refactoring should be performed for cleanup
function send_current_selections(channel_lobby, channel_a, channel_b) {

  var channel_tree_object = {
    channel_lobby: {
      name: channel_lobby.name,
      users: get_users_in_channel(channel_lobby)
    },
    channel_a: {
      name: channel_a.name,
      users: get_users_in_channel(channel_a)
    },
    channel_b: {
      name: channel_b.name,
      users: get_users_in_channel(channel_b)
    },
  }
  // Remove selection if user switches to lobby/waiting
  for (user of channel_tree_object.channel_lobby.users) {
    console.log("Removing user due to being in lobby:", user.id);
    user_to_ordnance.delete(user.id);
    user_to_titan.delete(user.id);
  }

  // Remove selection if user is no longer present
  // Get all users...
  let set_of_user_ids = get_set_of_user_ids(get_all_users_in_channels([channel_lobby, channel_a, channel_b]));
  // ...and remove inactive from mappings
  remove_inactive_from_mapping(user_to_ordnance, set_of_user_ids);
  remove_inactive_from_mapping(user_to_titan, set_of_user_ids);

  // Convert to string as we cannot send Maps via socket.io
  let user_to_ordnance_string = JSON.stringify(Array.from(user_to_ordnance));
  let user_to_titan_string = JSON.stringify(Array.from(user_to_titan));

  // Send message
  io.emit('update selections', channel_tree_object, user_to_ordnance_string, user_to_titan_string);

  return;
}

function remove_inactive_from_mapping(mapping, set_of_user_ids) {
  console.log("remove_inactive_from_mapping");
  console.log("Mapping:", mapping);
  for (const [user_id, _] of mapping.entries()) {
    if (!set_of_user_ids.has(user_id)) {
      mapping.delete(user_id);
    }
  }
}

bot.on('voiceStateUpdate', (oldMember, newMember) => {

  send_full_update_to_clients();
});
