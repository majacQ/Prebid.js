import {isEmpty, deepAccess, isStr} from '../src/utils.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';
import {config} from '../src/config.js';
import {BANNER, VIDEO} from '../src/mediaTypes.js';
import { Renderer } from '../src/Renderer.js';

const BIDDER_CODE = 'richaudience';
let REFERER = '';

export const spec = {
  code: BIDDER_CODE,
  gvlid: 108,
  aliases: ['ra'],
  supportedMediaTypes: [BANNER, VIDEO],

  /***
   * Determines whether or not the given bid request is valid
   *
   * @param {bidRequest} bid The bid params to validate.
   * @returns {boolean} True if this is a valid bid, and false otherwise
   */
  isBidRequestValid: function (bid) {
    return !!(bid.params && bid.params.pid && bid.params.supplyType);
  },
  /***
   * Build a server request from the list of valid BidRequests
   * @param {validBidRequests} is an array of the valid bids
   * @param {bidderRequest} bidder request object
   * @returns {ServerRequest} Info describing the request to the server
   */
  buildRequests: function (validBidRequests, bidderRequest) {
    return validBidRequests.map(bid => {
      var payload = {
        bidfloor: raiGetFloor(bid, config),
        ifa: bid.params.ifa,
        pid: bid.params.pid,
        supplyType: bid.params.supplyType,
        currencyCode: config.getConfig('currency.adServerCurrency'),
        auctionId: bid.auctionId,
        bidId: bid.bidId,
        BidRequestsCount: bid.bidRequestsCount,
        bidder: bid.bidder,
        bidderRequestId: bid.bidderRequestId,
        tagId: bid.adUnitCode,
        sizes: raiGetSizes(bid),
        referer: (typeof bidderRequest.refererInfo.referer != 'undefined' ? encodeURIComponent(bidderRequest.refererInfo.referer) : null),
        numIframes: (typeof bidderRequest.refererInfo.numIframes != 'undefined' ? bidderRequest.refererInfo.numIframes : null),
        transactionId: bid.transactionId,
        timeout: config.getConfig('bidderTimeout'),
        user: raiSetEids(bid),
        demand: raiGetDemandType(bid),
        videoData: raiGetVideoInfo(bid),
        scr_rsl: raiGetResolution(),
        cpuc: (typeof window.navigator != 'undefined' ? window.navigator.hardwareConcurrency : null),
        kws: (!isEmpty(bid.params.keywords) ? bid.params.keywords : null),
        schain: bid.schain
      };

      REFERER = (typeof bidderRequest.refererInfo.referer != 'undefined' ? encodeURIComponent(bidderRequest.refererInfo.referer) : null)

      payload.gdpr_consent = '';
      payload.gdpr = false;

      if (bidderRequest && bidderRequest.gdprConsent) {
        if (typeof bidderRequest.gdprConsent.gdprApplies != 'undefined') {
          payload.gdpr = bidderRequest.gdprConsent.gdprApplies;
        }
        if (typeof bidderRequest.gdprConsent.consentString != 'undefined') {
          payload.gdpr_consent = bidderRequest.gdprConsent.consentString;
        }
      }

      var payloadString = JSON.stringify(payload);

      var endpoint = 'https://shb.richaudience.com/hb/';

      return {
        method: 'POST',
        url: endpoint,
        data: payloadString,
      };
    });
  },
  /***
   * Read the response from the server and build a list of bids
   * @param {serverResponse} Response from the server.
   * @param {bidRequest} Bid request object
   * @returns {bidResponses} Array of bids which were nested inside the server
   */
  interpretResponse: function (serverResponse, bidRequest) {
    const bidResponses = [];
    // try catch
    var response = serverResponse.body;
    if (response) {
      var bidResponse = {
        requestId: JSON.parse(bidRequest.data).bidId,
        cpm: response.cpm,
        width: response.width,
        height: response.height,
        creativeId: response.creative_id,
        mediaType: response.media_type,
        netRevenue: response.netRevenue,
        currency: response.currency,
        ttl: response.ttl,
        meta: response.adomain,
        dealId: response.dealId
      };

      if (response.media_type === 'video') {
        bidResponse.vastXml = response.vastXML;
        try {
          if (bidResponse.vastXml != null) {
            if (JSON.parse(bidRequest.data).videoData.format == 'outstream' || JSON.parse(bidRequest.data).videoData.format == 'banner') {
              bidResponse.renderer = Renderer.install({
                id: bidRequest.bidId,
                adunitcode: bidRequest.tagId,
                loaded: false,
                config: response.media_type,
                url: 'https://cdn3.richaudience.com/prebidVideo/player.js'
              });
            }
            bidResponse.renderer.setRender(renderer);
          }
        } catch (e) {
          bidResponse.ad = response.adm;
        }
      } else {
        bidResponse.ad = response.adm;
      }

      bidResponses.push(bidResponse);
    }
    return bidResponses
  },
  /***
   * User Syncs
   *
   * @param {syncOptions} Publisher prebid configuration
   * @param {serverResponses} Response from the server
   * @param {gdprConsent} GPDR consent object
   * @returns {Array}
   */
  getUserSyncs: function (syncOptions, serverResponses, gdprConsent) {
    const syncs = [];

    var rand = Math.floor(Math.random() * 9999999999);
    var syncUrl = '';
    var consent = '';

    var raiSync = {};

    raiSync = raiGetSyncInclude(config);

    if (gdprConsent && typeof gdprConsent.consentString === 'string' && typeof gdprConsent.consentString != 'undefined') {
      consent = `consentString=${gdprConsent.consentString}`
    }

    if (syncOptions.iframeEnabled && raiSync.raiIframe != 'exclude') {
      syncUrl = 'https://sync.richaudience.com/dcf3528a0b8aa83634892d50e91c306e/?ord=' + rand
      if (consent != '') {
        syncUrl += `&${consent}`
      }
      syncs.push({
        type: 'iframe',
        url: syncUrl
      });
    }

    if (syncOptions.pixelEnabled && REFERER != null && syncs.length == 0 && raiSync.raiImage != 'exclude') {
      syncUrl = `https://sync.richaudience.com/bf7c142f4339da0278e83698a02b0854/?referrer=${REFERER}`;
      if (consent != '') {
        syncUrl += `&${consent}`
      }
      syncs.push({
        type: 'image',
        url: syncUrl
      });
    }
    return syncs
  },
};

registerBidder(spec);

function raiGetSizes(bid) {
  let raiNewSizes;
  if (bid.mediaTypes && bid.mediaTypes.banner && bid.mediaTypes.banner.sizes) {
    raiNewSizes = bid.mediaTypes.banner.sizes
  }
  if (raiNewSizes != null) {
    return raiNewSizes.map(size => ({
      w: size[0],
      h: size[1]
    }));
  }
}

function raiGetDemandType(bid) {
  let raiFormat = 'display';
  if (bid.mediaTypes != undefined) {
    if (bid.mediaTypes.video != undefined) {
      raiFormat = 'video';
    }
  }
  return raiFormat;
}

function raiGetVideoInfo(bid) {
  let videoData;
  if (raiGetDemandType(bid) == 'video') {
    videoData = {
      format: bid.mediaTypes.video.context,
      playerSize: bid.mediaTypes.video.playerSize,
      mimes: bid.mediaTypes.video.mimes
    };
  } else {
    videoData = {
      format: 'banner'
    }
  }
  return videoData;
}

function raiSetEids(bid) {
  let eids = [];

  if (bid && bid.userId) {
    raiSetUserId(bid, eids, 'id5-sync.com', deepAccess(bid, `userId.id5id.uid`));
    raiSetUserId(bid, eids, 'pubcommon', deepAccess(bid, `userId.pubcid`));
    raiSetUserId(bid, eids, 'criteo.com', deepAccess(bid, `userId.criteoId`));
    raiSetUserId(bid, eids, 'liveramp.com', deepAccess(bid, `userId.idl_env`));
    raiSetUserId(bid, eids, 'liveintent.com', deepAccess(bid, `userId.lipb.lipbid`));
    raiSetUserId(bid, eids, 'adserver.org', deepAccess(bid, `userId.tdid`));
  }

  return eids;
}

function raiSetUserId(bid, eids, source, value) {
  if (isStr(value)) {
    eids.push({
      userId: value,
      source: source
    });
  }
}

function renderer(bid) {
  bid.renderer.push(() => {
    renderAd(bid)
  });
}

function renderAd(bid) {
  let raOutstreamHBPassback = `${bid.vastXml}`;
  let raPlayerHB = {
    config: bid.params[0].player != undefined ? {
      end: bid.params[0].player.end != null ? bid.params[0].player.end : 'close',
      init: bid.params[0].player.init != null ? bid.params[0].player.init : 'close',
      skin: bid.params[0].player.skin != null ? bid.params[0].player.skin : 'light',
    } : {end: 'close', init: 'close', skin: 'light'},
    pid: bid.params[0].pid,
    adUnit: bid.adUnitCode
  };

  window.raParams(raPlayerHB, raOutstreamHBPassback, true);
}

function raiGetResolution() {
  let resolution = '';
  if (typeof window.screen != 'undefined') {
    resolution = window.screen.width + 'x' + window.screen.height;
  }
  return resolution;
}

function raiGetSyncInclude(config) {
  try {
    let raConfig = null;
    let raiSync = {};
    if (config.getConfig('userSync').filterSettings != null && typeof config.getConfig('userSync').filterSettings != 'undefined') {
      raConfig = config.getConfig('userSync').filterSettings
      if (raConfig.iframe != null && typeof raConfig.iframe != 'undefined') {
        raiSync.raiIframe = raConfig.iframe.bidders == 'richaudience' || raConfig.iframe.bidders == '*' ? raConfig.iframe.filter : 'exclude';
      }
      if (raConfig.image != null && typeof raConfig.image != 'undefined') {
        raiSync.raiImage = raConfig.image.bidders == 'richaudience' || raConfig.image.bidders == '*' ? raConfig.image.filter : 'exclude';
      }
    }
    return raiSync;
  } catch (e) {
    return null;
  }
}

function raiGetFloor(bid, config) {
  try {
    let raiFloor;
    if (bid.params.bidfloor != null) {
      raiFloor = bid.params.bidfloor;
    } else if (typeof bid.getFloor == 'function') {
      let floorSpec = bid.getFloor({
        currency: config.getConfig('floors.data.currency') != null ? config.getConfig('floors.data.currency') : 'USD',
        mediaType: typeof bid.mediaTypes['banner'] == 'object' ? 'banner' : 'video',
        size: '*'
      })

      raiFloor = floorSpec.floor;
    }
    return raiFloor
  } catch (e) {
    return 0
  }
}
