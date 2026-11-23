// SETTINGS FOR "GENERATE REPLY", "GENERATE QUOTE" AND THE REMINDER
// Edit the values, keep the punctuation, and save.

export default {
  // The main tag.
  alwaysTag: '#TheRiftBorn',

  // Replies: how many replies out of 10 carry the main tag. The rest carry no tag.
  // A reply never carries any other tag. X treats a pile of tags in replies as spam.
  replyTagOutOfTen: 8,

  // Quotes always carry the main tag. How many quotes out of 10 also carry
  // one extra tag from the list below. The AI picks the one that fits best.
  quoteExtraTagOutOfTen: 5,

  // When the words already say "the Rift Born", The Crier turns those words into the
  // main tag, in place of adding the tag at the end. So not every reply ends the same way.

  // The extra tags for quotes.
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
