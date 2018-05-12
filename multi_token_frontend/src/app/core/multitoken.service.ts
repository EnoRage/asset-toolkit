import {
  ConnectionService,
  HelperService,
  EventService,
} from '.';
import { Account, Contract, PromiEvent, Tx, Transaction } from 'web3/types';
import { Connection } from '../shared/types';
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs/Subject';
import { ErrorMessageService } from '../shared/services/index';
import { to } from 'await-to-js';
import * as moment from 'moment';

@Injectable()
export class MultitokenService {

  public lastToken: string;
  public lastDivToken: string;
  public transactions: Subject<any[]> = new Subject();
  public tokens: Subject<any> = new Subject();
  public divTransactions: Subject<any[]> = new Subject();
  public dividends: Subject<any> = new Subject();

  private fetchDataDelay = 5000;
  private userAddress: string;
  private contractAddress: string;
  private balances: any;
  private contract: Contract;

  constructor(
    private $connection: ConnectionService,
    private $error: ErrorMessageService,
    private $events: EventService,
    private $helper: HelperService,
  ) {
    $connection.subscribe(status => {
      if (status === Connection.Estableshed) {
        this.contractAddress = $connection.contractData.address;
        this.userAddress = $connection.account;
        this.contract = $connection.contract;
        this.startLoops();
      }
    })
  }

  //#region Send Methods

  public initSubTokens(tokenId, value): PromiEvent<Transaction> {
    console.log(`TokenId: ${tokenId.toString()}, Value: ${value.toString()}`)
    return this.contract.methods.init(tokenId, value).send({from: this.userAddress});
  };

  public transferTokens(tokenId, address, amount): PromiEvent<Transaction> {
    console.log(`TokenId: ${tokenId.toString()}, Address: ${address},Amount: ${amount.toString()}`)
    return this.contract.methods.transfer(tokenId, address, amount).send({from: this.userAddress});
  };

  public acceptDividends(tokenId, value): PromiEvent<Transaction> {
    console.log(`TokenId: ${tokenId.toString()}, Value: ${value.toString()}`)
    return this.contract.methods.acceptDividends(tokenId).send({from: this.userAddress, value});
  };

  public withdrawDividends(tokenId, value): PromiEvent<Transaction> {
    console.log(`TokenId: ${tokenId.toString()}, Value: ${value.toString()}`)
    return this.contract.methods.releaseDividendsRights(tokenId, value).send({from: this.userAddress});
  };

  //#endregion

  //#region Utility Methods

  public async getAllInitedTokenIds() {
    const tokenType = [];
    const transfers = await this.contract.getPastEvents(
      'Transfer', { fromBlock: 0, filter: { from: '0X0000000000000000000000000000000000000000' }});
    transfers.forEach((event, index, array) => {
      const { tokenId }  = event.returnValues;
      if (tokenType.indexOf(tokenId) === -1) { tokenType.push(tokenId); }
    });
    return tokenType;
  };

  public getOwner() {
    return this.contract.methods.owner().call();
  }

  public async getBalances() {
    const cells = await this.getCells();
    const balances = {};
    const pendings = await this.getPendings();
    await Promise.all(cells.map(async (tokenId) => {
      balances[tokenId] = await this.getBalance(tokenId);
      balances[tokenId].pending = pendings[tokenId] || [];
      return null;
    }));
    this.tokens.next(balances);
  };

  public getTokenBalance(tokenId): Promise<string> {
    return this.contract.methods.balanceOf(tokenId, this.userAddress).call();
  }

  public async getDetails(tokenId) {
    const transfersOnTokenIdFrom = await this.contract.getPastEvents(
      'Transfer', { fromBlock: 0, filter: { from: this.userAddress, tokenId }});
    const transfersOnTokenIdTo = await this.contract.getPastEvents(
      'Transfer', { fromBlock: 0, filter: { to: this.userAddress, tokenId }});
    const transfersOnTokenId = transfersOnTokenIdFrom.concat(transfersOnTokenIdTo);
    const pendings = await this.getPendings();
    const details = await Promise.all(transfersOnTokenId.map(async (ev) => {
      const blockAdded = await this.$connection.web3.eth.getBlock(ev.blockHash);
      const date = blockAdded.timestamp * 1000;
      const plus = (ev.returnValues.to === this.userAddress);
      const address = (plus) ? ev.returnValues.from : ev.returnValues.to;
      const value = Number((plus) ? ev.returnValues.value : -ev.returnValues.value);
      return { address, date, value };
    }));
    if (pendings[tokenId]) {
      pendings[tokenId].forEach((elem) => {
        const pend = {
          address: elem.address,
          value: -elem.value,
          date: 0,
        };
        details.push(pend);
      });
    }
    this.lastToken = tokenId; // should assign before brodcasting transactions!
    this.transactions.next(details);
  };

  public async getDividendsBalances() {
    const cells = await this.getCells();
    const divBalances = {};
    await Promise.all(cells.map(async (tokenId) => {
      divBalances[tokenId] = await this.getDividendsBalance(tokenId);
      return null;
    }));
    this.dividends.next(divBalances);
  };

  public async getDividendsDetails(tokenId) {
    const details = [];
    const releaseDividendsRights = await this.contract.getPastEvents(
      'ReleaseDividendsRights', { fromBlock: 0, filter: { _for: this.userAddress, tokenId }});
    await Promise.all(releaseDividendsRights.map(async (ev) => {
      const blockAdded = await this.$connection.web3.eth.getBlock(ev.blockHash);
      const date = blockAdded.timestamp * 1000;
      const value = -Number(ev.returnValues.value);
      details.push({ date, value, accept: 0, part: 0 });
      return null;
    }));
    const acceptDividends = await this.contract.getPastEvents(
      'AcceptDividends', { fromBlock: 0, filter: { tokenId }});
    await Promise.all(acceptDividends.map(async (ev) => {
      const blockAdded = await this.$connection.web3.eth.getBlock(ev.blockHash);
      const date = blockAdded.timestamp * 1000;
      const part = await this.getTokenPartOnAcceptDividendsEvent(ev);
      const accept = Number(ev.returnValues.value);
      const value = accept * part;
      details.push({ date, accept, part, value });
      return null;
    }));
    this.lastDivToken = tokenId; // should assign before brodcasting transactions!
    this.divTransactions.next(details);
  };

  public resetTransactionsHistory() {
    this.lastDivToken = undefined;
    this.lastToken = undefined;
    this.transactions.next([]);
    this.divTransactions.next([]);
  }

  //#endregion

  //#region Private Methods

  private startLoops() {
    this.getBalances();
    this.getDividendsBalances();
    setInterval(this.getBalances.bind(this), this.fetchDataDelay);
    setInterval(this.getDividendsBalances.bind(this), this.fetchDataDelay);
    setInterval(() => {
      if (this.lastToken) {
        this.getDetails(this.lastToken)
      };
      if (this.lastDivToken) {
        this.getDividendsDetails(this.lastDivToken)
      }
    }, this.fetchDataDelay)
        /*
        this.contract.events.Transfer({
          fromBlock: 'latest',
          filter: { from: this.userAddress }
        }).on('data', async (event) => {
          // const { tokenId } = event.returnValues;
          // this.balances[tokenId] = await this.getBalance(tokenId);
          this.getBalances();
        });

        this.contract.events.Transfer({
          fromBlock: 'latest',
          filter: { to: this.userAddress }
        }).on('data', async (event) => {
          // const { tokenId } = event.returnValues;
          // this.balances[tokenId] = await this.getBalance(tokenId);
          this.getBalances();
        });
    */
  }

  // Dividends Tab
  private getDividendsBalance = async (tokenId) => {
    return await this.contract.methods.dividendsRightsOf(tokenId, this.userAddress).call();
  };

  private getTokenPartOnAcceptDividendsEvent = async (event) => {
    const tokenId = event.returnValues.tokenId;
    const blockAdded = await this.$connection.web3.eth.getBlock(event.blockHash);
    const transfersOnTokenIdFrom = await this.contract.getPastEvents(
      'Transfer', { fromBlock: 0, toBlock: blockAdded.number, filter: { from: this.userAddress, tokenId }});
    const transfersOnTokenIdTo = await this.contract.getPastEvents(
      'Transfer', { fromBlock: 0, toBlock: blockAdded.number, filter: { to: this.userAddress, tokenId }});
    const transfersOnTokenId = transfersOnTokenIdFrom.concat(transfersOnTokenIdTo);
    let sum = 0;
    await Promise.all(transfersOnTokenId.map(async (ev) => {
      const plus = (ev.returnValues.to === this.userAddress) ? 1 : -1;
      const value = Number(ev.returnValues.value) * plus;
      sum += value;
      return null;
    }));
    const totalSupply = await this.contract.methods.totalSupply(tokenId).call();
    return sum / totalSupply;
  };

  private getCells = async () => {
    const cells = [];
    const transferedCellsFrom = await this.contract.getPastEvents(
      'Transfer', { fromBlock: 0, filter: { from: this.userAddress }});
    const transferedCellsTo = await this.contract.getPastEvents(
      'Transfer', { fromBlock: 0, filter: { to: this.userAddress }});
    const transferedCells = transferedCellsFrom.concat(transferedCellsTo);
    transferedCells.forEach((event, index, array) => {
      const { tokenId }  = event.returnValues;
      if (cells.indexOf(tokenId) === -1) { cells.push(tokenId); }
    });
    return cells;
  };

  // Tokens Tab
  private getBalance = async (tokenId) => {
    const amount = await this.contract.methods.balanceOf(tokenId, this.userAddress).call();
    const totalSupply = await this.contract.methods.totalSupply(tokenId).call();
    const part = Math.round(amount / totalSupply * 100);
    const pending = {};
    return { amount, part, pending };
  };

  private getPendings = async () => {
    const { transactions } = await this.$connection.web3.eth.getBlock('pending', true);
    const userTransactions = transactions.filter((elem) => (elem.from === this.userAddress));
    const pendings = {};
    await Promise.all(userTransactions.map(async (elem) => {
      const transaction = await this.$connection.web3.eth.getTransaction(elem.hash);
      const tokenId = this.$connection.web3.utils.hexToNumber(transaction.input.slice(-192, -128));
      const pending = {
        address: transaction.input.slice(-128, -64).replace(/^0*/, '0x'),
        value: this.$connection.web3.utils.hexToNumber(transaction.input.slice(-64))
      };
      if (!Array.isArray(pendings[tokenId])) {
        pendings[tokenId] = [];
      }
      pendings[tokenId].push(pending);
      return null;
    }));
    return pendings;
  };

  //#endregion
}
