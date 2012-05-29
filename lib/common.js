/*
 * pushit shared functions
 */


var VERBOSE = false;
var DEBUG = false;


function verbose() {
  if (arguments.length == 0)
    return VERBOSE;

  if (!VERBOSE)
    return;

  console.log.apply(null, Array.prototype.slice.apply(arguments));
}


function debug() {
  if (arguments.length == 0)
    return DEBUG;

  if (!DEBUG)
    return;

  console.log.apply(null, Array.prototype.slice.apply(arguments));
}



module.exports = {
  debug: debug,
  verbose: verbose,
  setDebug: function (val) { DEBUG = val; },
  setVerbose: function (val) { VERBOSE = val; }
};
