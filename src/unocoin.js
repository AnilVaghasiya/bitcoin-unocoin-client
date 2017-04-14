var Exchange = require('bitcoin-exchange-client');
var UnocoinProfile = require('./profile');
var Trade = require('./trade');
var UnocoinKYC = require('./kyc');
var PaymentMedium = require('./payment-medium');
var ExchangeRate = require('./exchange-rate');
var Quote = require('./quote');
var API = require('./api');
var Bank = require('./bank');

var assert = require('assert');

class Unocoin extends Exchange.Exchange {
  constructor (object, delegate) {
    super(delegate, Trade, Quote, PaymentMedium);

    assert(delegate.getToken, 'delegate.getToken() required');

    var obj = object || {};
    this._user = obj.user;
    this._auto_login = obj.auto_login;
    this._offlineToken = obj.offline_token;

    this._api = new API('https://app-api.unocoin.com/');
    this._api._offlineToken = this._offlineToken;

    this._profile = new UnocoinProfile(this._api);

    this._buyCurrencies = ['INR'];
    this._sellCurrencies = ['INR'];

    this._trades = [];
    if (obj.trades) {
      for (let tradeObj of obj.trades) {
        var trade = new Trade(tradeObj, this._api, delegate, this);
        trade._getQuote = Quote.getQuote; // Prevents circular dependency
        trade.debug = this._debug;
        this._trades.push(trade);
      }
    }

    this._kycs = [];

    this.exchangeRate = new ExchangeRate(this._api);

    this._bank = new Bank(this._api, delegate);
  }

  get profile () {
    if (!this._profile._did_fetch) {
      return null;
    } else {
      return this._profile;
    }
  }

  get kycs () { return this._kycs; }

  get hasAccount () { return Boolean(this._offlineToken); }

  get buyCurrencies () { return this._buyCurrencies; }

  get sellCurrencies () { return this._sellCurrencies; }

  get bank () { return this._bank; }

  toJSON () {
    var unocoin = {
      user: this._user,
      offline_token: this._offlineToken,
      auto_login: this._auto_login,
      trades: this._TradeClass.filteredTrades(this._trades)
    };

    return unocoin;
  }

  // Email must be set and verified
  signup () {
    var self = this;
    var runChecks = function () {
      assert(!self.user, 'Already signed up');

      assert(self.delegate, 'ExchangeDelegate required');

      assert(self.delegate.email(), 'email required');
      assert(self.delegate.isEmailVerified(), 'email must be verified');
    };

    var doSignup = function (emailToken) {
      assert(emailToken, 'email token missing');
      return this._api.POST('api/v1/authentication/register', {
        email_id: self.delegate.email()
      }, {
        Authorization: `Bearer ${emailToken}`
      }).catch(() => {}).then(() => {
        // Pending CORS fixes, just copy-paste result from Postman:
        return {
          result: 'success',
          access_token: '303e7aa8d37c4889bf0bfba9c108ff8ed50b30e7',
          message: 'Thank you.',
          status_code: 200
        };
      });
    };

    var saveMetadata = function (res) {
      this._user = self.delegate.email();
      this._offlineToken = res.access_token;
      this._api._offlineToken = this._offlineToken;
      return this._delegate.save.bind(this._delegate)().then(function () { return res; });
    };

    var getToken = function () {
      return this.delegate.getToken.bind(this.delegate)('unocoin', {walletAge: true});
    };

    return Promise.resolve().then(runChecks.bind(this))
                            .then(getToken.bind(this))
                            .then(doSignup.bind(this))
                            .then(saveMetadata.bind(this));
  }

  fetchProfile () {
    return this._profile.fetch();
  }

  triggerKYC () {
    var addKYC = (kyc) => {
      this._kycs.push(kyc);
      return kyc;
    };

    return UnocoinKYC.trigger(this._api).then(addKYC);
  }

  getKYCs () {
    var save = () => this.delegate.save.bind(this.delegate)().then(() => this._kycs);
    var update = (kycs) => {
      this.updateList(this._kycs, kycs, UnocoinKYC);
    };
    return UnocoinKYC.fetchAll(this._api, this)
                       .then(update)
                       .then(save);
  }

  getBuyCurrencies () {
    return Promise.resolve(this._buyCurrencies);
  }

  getSellCurrencies () {
    return Promise.resolve(this._sellCurrencies);
  }

  sell (quote, bank) {
    assert(quote, 'Quote is required');
    assert(quote.expiresAt > new Date(), 'QUOTE_EXPIRED');

    const sellData = {
      priceQuoteId: quote.id,
      transferIn: {
        medium: 'blockchain'
      },
      transferOut: {
        medium: 'bank',
        mediumReceiveAccountId: bank.id
      }
    };
    return this._api.authPOST('trades', sellData);
  }

  static new (delegate) {
    assert(delegate, 'Unocoin.new requires delegate');
    var object = {
      auto_login: true
    };
    var unocoin = new Unocoin(object, delegate);
    return unocoin;
  }
}

module.exports = Unocoin;
