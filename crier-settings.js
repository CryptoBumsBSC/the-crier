// SETTINGS FOR "GENERATE REPLY", "GENERATE QUOTE" AND THE REMINDER
// Edit the values, keep the punctuation, and save.

export default {
  // This tag goes on every generated reply.
  alwaysTag: '#TheRiftBorn',

  // Two of these are added to every generated reply. The AI picks the two that fit best.
  extraTags: ['#Genesis333', '#Boomerverse', '#AussieBoomer', '#TheRiftNFTs', '#WildlifeConservation', '#InvestingInSurvival', '#DigiNFTs', '#NFTCommunity', '#NFTs'],

  // X accounts that may be tagged in place of a hashtag. Only add accounts that are
  // yours or that have agreed. Example: ['@Boomer_Au']
  approvedMentions: [],

  // How many replies one member can generate for one tweet.
  repliesPerMemberPerTweet: 3,

  // How many quotes one member can generate for one tweet.
  quotesPerMemberPerTweet: 3,

  // The most replies and quotes (added together) The Crier writes in any 24 hours,
  // across all groups. Caps the AI cost.
  repliesPerDay: 300,

  // The reminder: how many hours before the unpin The Crier posts one line under the post,
  // such as "14 members are in. Still time to join." Use 0 to switch the reminder off.
  reminderHoursBeforeUnpin: 6,
};
