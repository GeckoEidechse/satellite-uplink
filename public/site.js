// Global variables
var selection_html_strings = '';
var socket = io();

/**
 * Clear current callout display and create a new one based on selection
 * Creates an iframe and sets it as the content of the callout_container
 * @param {String} callout_type A string signifying the desired callout map
 */
function toggle_callout_display(callout_type) {
  // Clear HTML element
  $('#inner_callout_container').html("");
  // Add iframe if appropriate button is pressed
  if (callout_type == "basic") {
    $('#inner_callout_container').append('<iframe src="https://docs.google.com/presentation/d/e/2PACX-1vSLW9PFz6kfB7F1TJnXY1uHnZLi89bExHlYRTgLcGOE6fJi6t23Cs5xKEqCGYYE_llgdUsBmYVdZTLf/embed?start=false&loop=false&delayms=3000" frameborder="0" width="960" height="569" allowfullscreen="true" mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>');
  }
  if (callout_type == "full") {
    $('#inner_callout_container').append('<iframe src="https://docs.google.com/presentation/d/e/2PACX-1vTvuwVzSbumH9uWgYxMVSfTOxzpzehRQlS9g9CQ8NFAHdGynYiQprnV5XXGznnxVBdjISy-dDNy3OkF/embed?start=false&loop=false&delayms=3000" frameborder="0" width="960" height="569" allowfullscreen="true" mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>');
  }
}

/**
 * Returns the string of an HTML image element containing the users avatar
 * @param {Object} user User object, consisting out of id, name, and avatar id
 * @returns String representing the 
 */
function get_image_tag(user) {
  // Get user's avatar if they have one...
  if (user.avatar)
    var url = "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + ".png?size=256";
  else
    // otherwise use a default
    var url = "https://discord.com/assets/dd4dbc0016779df1378e7812eabaa04d" + ".png?size=256";

  let tag = " <img src=\"" + url + "\" alt=\"(" + user.name + "'s avatar)\" style=\"border-radius: 50%; width: 30px\"> "
  return tag;
}

/**
 * Sends a message to the server with the updated choice made by the user
 * @param select Object of the pressed button
 * @param {String} option_name Category id of the item to update
 */
function update_choice(select, option_name) {

  var selection_update = {
    option_name: option_name,
    choice: select.classList[0],
    user_id: String(select.parentElement.parentElement.parentElement.id)
  }
  socket.emit('update choice', selection_update);
}

/**
 * Decrement times a choice is available by one
 * @param {Object} selection Object of selected item in ruleset
 * @param {String} id id of item
 * @returns Modified object of selected item in ruleset
 */
function decrement_available(selection, id) {

  if (selection.id == id && selection.max_per_team != null) {
    var result = {
      "id": selection.id,
      "name": selection.name,
      "max_per_team": selection.max_per_team - 1
    };
    return result;
  }
  else
    return selection;
}

/**
 * Get currently available choices based on ruleset and selections for a specific category
 * @param {Array} channel_users List of user objects in specific channel.
 * @param {Map} user_to_selection Map from user id to item id
 * @param rules_copy_category Scope of the current category of copy of ruleset
 * @returns Modified ruleset object adjusted by selected items in the current category
 */
function get_current_available_per_category(channel_users, user_to_selection, rules_copy_category) {
  // For all users
  for (const user of channel_users) {
    // Get their selection
    let selection = user_to_selection.get(user.id);
    // Reduce number of available items if user selected one
    if (selection) {
      rules_copy_category = rules_copy_category.map(
        function (element) {
          return decrement_available(element, selection);
        }
      );
    }
  }
  return rules_copy_category;

}

/**
 * Display available items based on ruleset and selections
 * @param {Array} channel_users List of user objects in specific channel.
 * @param {String} html_object_id HTML id of the HTML object containing the current channel
 * @param {Object} user_to_category_item Objects of selection mappings
 */
function display_available_for_channel(channel_users, html_object_id, user_to_category_item) {

  // Clone object
  var rules_copy = jQuery.extend(true, {}, current_ruleset);

  // Set the according selection for the according users
  for (category of current_ruleset.rule_names) {

    // Get the mapping for current category
    user_to_selection_object = user_to_category_item.find(element => element.id == category);

    // Skip if we found no mapping
    if (user_to_selection_object == null) {
      console.log("Received no mapping for \"" + category + "\" skipping...");
      continue;
    }

    // user_to_selection_string = user_to_selection_object.mapping_string;
    var user_to_selection = new Map(JSON.parse(user_to_selection_object.mapping_string));

    // Update available items for the current category
    rules_copy[category].choices = get_current_available_per_category(channel_users, user_to_selection, rules_copy[category].choices);
  }

  // Create HTML string containing elements representing available choices
  var available_html_string = '';
  available_html_string += '<hr />' + '<b>Available:</b>' + '<br />' + '<div style="display: flex;">';
  for (const category of rules_copy.rule_names) {
    for (const item of rules_copy[category].choices) {
      if (item.max_per_team > 0 || item.max_per_team == null) {
        available_html_string += '<div style="margin: 1px">' + '<img src="/images/icons/' + category + 's/' + item.id + '.png" alt="' + item.name + '" title="' + item.name + '" width="30px" height="30px" style="border-radius: 15%;"></img> ' + '</div>';
      }  
    }
    available_html_string += '</div>' + '<div style="display: flex;">'
  }
  available_html_string += '</div>';

  // Clear content
  $(html_object_id).html("");

  // Redraw
  $(html_object_id).append(available_html_string);

  // Show warnings if there is too many of a certain selection
  for (rule_name of current_ruleset.rule_names) {
    for (const item of rules_copy[rule_name].choices) {
      if (item.max_per_team < 0 && item.max_per_team != null) {
        $(html_object_id).append('<p style="color: red">Too many: ' + item.name + ' !</p>');
      }
    }
  }
}

// Call when channel tree has changed
socket.on('update channel tree', function (channel_tree, user_to_category_item) {
  /* Redraw channel tree if there have been changes */

  // Clear previous content
  $('#channel_trees').html("");

  // Add lobby
  $('#channel_trees').append(
    '<div id="' + channel_tree.channel_lobby.id + '" class="lobby channel"><h1>' + channel_tree.channel_lobby.name + '</h1><ul id="lobby_userlist"></ul></div>'
  )
  // Add team channels
  $('#channel_trees').append('<div id="team_channels"></div>')
  for (channel of channel_tree.team_channels) {
    if (channel.users.length) { // Only draw teamchannel if it has users
      $('#team_channels').append(
        '<div id="' + channel.id + '" class="teams channel"><h2>' + channel.name + '</h2><ul id="' + channel.id + '_userlist"></ul><div id="' + channel.id + '_available"></div></div>'
      )
    }
  }

  // Sort channel list
  channel_tree.channel_lobby.users.sort((a, b) => a.name.localeCompare(b.name));
  for (channel of channel_tree.team_channels) {
    channel.users.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Update list for each user
  for (const user of channel_tree.channel_lobby.users) {
    $('#lobby_userlist').append("<li class=\"user\">" + get_image_tag(user) + user.name + "</li>");
  }
  // Go through all channels...
  for (channel of channel_tree.team_channels) {
    // ...and all users in that channel
    for (const user of channel.users) {
      // Add list entry for user
      let user_list_entry_string = "<li class=\"user\" id=\"" + user.id + "\">";
      // Buttons for different categories
      for (selection_html_string of selection_html_strings) {
        user_list_entry_string += selection_html_string;
      }
      user_list_entry_string += get_image_tag(user) + user.name + "</li>"
      $('#' + channel.id + '_userlist').append(user_list_entry_string);
    }
  }
  update_according_to_selections(channel_tree, user_to_category_item);
});

/**
 * 
 * @param {*} channel_tree 
 * @param {string} user_to_ordnance_string 
 * @param {string} user_to_titan_string 
 */
function update_according_to_selections(channel_tree, user_to_category_item) {
  /* Update user choices based on selections by other users */

  // Set the according selection for the according users
  for (category of current_ruleset.rule_names) {

    // Get the mapping for current category
    user_to_selection_object = user_to_category_item.find(element => element.id == category);

    // Skip if we found no mapping
    if (user_to_selection_object == null) {
      console.log("Received no mapping for \"" + category + "\" skipping...");
      continue;
    }

    // user_to_selection_string = user_to_selection_object.mapping_string;
    var user_to_selection = new Map(JSON.parse(user_to_selection_object.mapping_string));

    for (const [key, value] of user_to_selection.entries()) {
      $("#" + key).find(".dropbtn." + category).html('<img class="icon_image" src="/images/icons/' + category + 's/' + value + '.png" alt="' + value + '" width="30px" height="30px">');
    }
  }

  // Update available items
  for (channel of channel_tree.team_channels) {
    display_available_for_channel(channel.users, '#' + channel.id + '_available', user_to_category_item);
  }
}
socket.on('update selections', function (channel_tree, user_to_category_item) {
  update_according_to_selections(channel_tree, user_to_category_item);
});

/**
 * Creates a string representing a dropdown button in HTML
 * @param name Category name
 * @param id Category id
 * @param options The different items to choose from
 */
function get_html_selection_string(name, id, options) {
  // Creates HTML string that contains list of `options`
  let html_string = '';
  html_string += '<div class="dropdown">';
  html_string += '<button class="dropbtn ' + id + '">' + name + '</button>';
  html_string += '<div class="dropdown-content">';
  // Add default empty selection
  html_string += '<button class="not_selected dropdown-menu-button" onclick="update_choice(this, \'' + id + '\');"><img class="icon_image" src="/images/icons/' + id + 's/not_selected.png" alt="not_selected" width="30px" height="30px"></button>';

  for (const option of options) {
    html_string += '<button class="' + option.id + ' dropdown-menu-button" onclick="update_choice(this, \'' + id + '\');"><img class="icon_image" src="/images/icons/' + id + 's/' + option.id + '.png" alt="' + option.name + '" width="30px" height="30px"></button>'
  }
  html_string += '</div>';
  html_string += '</div>';
  return html_string;
}

/**
 * Returns the requested ruleset
 * @param {Object} rules The full rules object
 * @param {String} ruleset_id The id of the requested ruleset
 * @returns The requested ruleset
 */
function get_ruleset(rules, ruleset_id) {
  return rules.rule_sets.find(obj => {
    return obj.id === ruleset_id // Get the ruleset with the matchind id
  })
}

// Load ruleset
var url = '/rules.json';
var rules = {};
$.ajax({
  type: 'GET',
  url: url,
  dataType: 'json',
  success: function (data) { rules = data; },
  async: false
});

// Get the default ruleset
current_ruleset = get_ruleset(rules, rules.default);

// Apply rules
for(rule_name of current_ruleset.rule_names) {
  selection_html_strings += get_html_selection_string(
      current_ruleset[rule_name].name,
      rule_name,
      current_ruleset[rule_name].choices
  );
}
// Get channel tree and selections on load
window.onload = socket.emit('new client');
