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
const GLOBAL_LIST_TEAMCHANNEL_IDS = process.env.GLOBAL_TEAMCHANNEL_IDS.split(',')

bot.login(TOKEN);

// ========================================

/**
 * Discord Obeserver Bot part
 */
bot.on('ready', () => {
  console.info(`Logged in as ${bot.user.tag}!`);
  /**
   * Webserver part
   */
  app.use(express.static(path.join(__dirname, 'public')));
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  app.get('/', (req, res, next) => {
    res.set('Permissions-Policy', 'interest-cohort=()'); // This disables FLoC for this site, c.f.: https://amifloced.org/
    res.render('index');
  });

  io.on('connection', (socket) => {
    console.log("a user connected via socket!");
    socket.on('disconnect', () => {
      console.log("a user disconnected");
    });


    socket.on('update choice', function (choice_update) {
      console.debug("Received data:");
      console.debug(choice_update);

      // Apply ordnance or titan update depending on type
      if (choice_update.option_name == 'ordnance') {
        user_to_ordnance.set(choice_update.user_id, choice_update.choice);
        console.debug(user_to_ordnance);
      }
      if (choice_update.option_name == 'titan') {
        user_to_titan.set(choice_update.user_id, choice_update.choice);
        console.debug(user_to_titan);
      }
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
});

bot.on('message', msg => {
  // Do nothing on msg
});

/**
 * Gets watched channel objects and calls the appropriate function to send an update to the client
 * which causes it to rebuild the channel tree and update selections
 */
function send_full_update_to_clients() {
  let channel_waiting = bot.channels.cache.get(GLOBAL_CHANNEL_ID_WAITING);
  let team_channels = GLOBAL_LIST_TEAMCHANNEL_IDS.map((channel) => bot.channels.cache.get(channel))

  send_users_in_all_channels(channel_waiting, team_channels);
}

/**
 * Gets watched channel objects and calls the appropriate function to send an update to the client
 * which causes it to update selections
 */
function send_selection_update_to_clients() {
  let channel_waiting = bot.channels.cache.get(GLOBAL_CHANNEL_ID_WAITING);
  let team_channels = GLOBAL_LIST_TEAMCHANNEL_IDS.map((channel) => bot.channels.cache.get(channel))

  send_current_selections(channel_waiting, team_channels);
}

/**
 * Takes channel and returns a list of users in that channel
 * @param {Object} channel Object describing a specific channel
 * @returns List of user objects in a channel in the form [{id, name, avatar}, ...]
 */
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

/**
 * Returns an array of user objects that are currently in one of the given channels
 * @param {List} list_of_channels List of channels to get user ids from
 * @returns An array of objects
 */
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

/**
 * Returns a set of user ids created from a list of user objects
 * @param users List of user objects
 * @returns A set of user ids
 */
function get_set_of_user_ids(users) {
  var set_of_user_ids = new Set();
  for (user of users) {
    set_of_user_ids.add(user.id);
  }
  return set_of_user_ids;
}

function get_data_to_send(channel_lobby, team_channels) {

  var channel_tree_object = {
    channel_lobby: {
      name: channel_lobby.name,
      id: channel_lobby.id,
      users: get_users_in_channel(channel_lobby)
    },
    team_channels: []
  }

  // Add channels to `channel_tree_object`
  for (channel of team_channels) {
    channel_tree_object.team_channels.push(
      {
        name: channel.name,
        id: channel.id,
        users: get_users_in_channel(channel)
      }
    )
  }

  // Remove selection if user switches to lobby/waiting
  for (user of channel_tree_object.channel_lobby.users) {
    console.log("Removing user due to being in lobby:", user.id);
    user_to_ordnance.delete(user.id);
    user_to_titan.delete(user.id);
  }

  // Remove selection if user is no longer present
  // Get all users...
  let set_of_user_ids = get_set_of_user_ids(get_all_users_in_channels(team_channels.concat([channel_lobby])));
  // ...and remove inactive from mappings
  remove_inactive_from_mapping(user_to_ordnance, set_of_user_ids);
  remove_inactive_from_mapping(user_to_titan, set_of_user_ids);

  // Convert to string as we cannot send Maps via socket.io
  let user_to_ordnance_string = JSON.stringify(Array.from(user_to_ordnance));
  let user_to_titan_string = JSON.stringify(Array.from(user_to_titan));

  // Create object to send manually. In the future this should be made generic
  let user_to_category_item = [
    {
      id: 'ordnance',
      mapping_string: user_to_ordnance_string
    },
    {
      id: 'titan',
      mapping_string: user_to_titan_string
    }
  ]

  // Return data
  return { channel_tree_object: channel_tree_object, user_to_category_item: user_to_category_item };
}

/**
 * Sends the channel tree object and user selections to the client
 * Causes the client to update the tree and user selections
 * @param {Object} channel_lobby Lobby channel
 * @param {List} team_channels List of channels (excluding the lobby channel)
 */
function send_users_in_all_channels(channel_lobby, team_channels) {
  // Get data to send
  const { channel_tree_object, user_to_category_item } = get_data_to_send(channel_lobby, team_channels);
  // Send message
  io.emit('update channel tree', channel_tree_object, user_to_category_item);

  return;
}

/**
 * Sends the channel tree object and user selections to the client
 * Causes the client to update only user selections
 * @param {Object} channel_lobby Lobby channel
 * @param {List} team_channels List of channels (excluding the lobby channel)
 */
function send_current_selections(channel_lobby, team_channels) {
  // Get data to send
  const { channel_tree_object, user_to_category_item } = get_data_to_send(channel_lobby, team_channels);
  // Send message
  io.emit('update selections', channel_tree_object, user_to_category_item);

  return;
}

/**
 * Takes the given mapping and removes all users that are no longer in the given set of user ids
 * i.e. left a team channel
 * @param {Map} mapping Mapping from user id to their selected item in that category
 * @param {Set} set_of_user_ids Set containing all user ids (excluding those in the lobby channel)
 */
function remove_inactive_from_mapping(mapping, set_of_user_ids) {
  console.log("remove_inactive_from_mapping");
  console.log("Mapping:", mapping);
  for (const [user_id, _] of mapping.entries()) {
    if (!set_of_user_ids.has(user_id)) {
      mapping.delete(user_id);
    }
  }
}

// Gets called whenever there's a change in the channel voice state.
// This includes a user leaving/joining and someone (un)muting themselves
bot.on('voiceStateUpdate', (oldMember, newMember) => {

  send_full_update_to_clients();
});
