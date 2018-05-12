import { Injectable } from '@angular/core';
import Web3 from 'web3';
import { ValidatorFn, AbstractControl } from '@angular/forms';

@Injectable()
export class FormService {

  public web3 = new Web3;
  public utils = this.web3.utils;

  constructor(
  ) {
  }

  public  walletAddressValidator(): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
      const isAddress = this.web3.utils.isAddress(control.value);
      const error = {};
      error['validAddress'] = {value: control.value}
      return !control.value || isAddress ? null : error;
    };
  }

  public tokenNotExistsValidator(tokenIds: string[]): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
      const error = {};
      error['exists'] = {value: control.value};
      return tokenIds.indexOf(this.remove0x(control.value)) < 0 ? null : error;
    }
  }

  public tokenExistsValidator(tokenIds: string[]): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
      const error = {};
      error['not-exists'] = {value: control.value};
      return !control.value || tokenIds.indexOf(this.remove0x(control.value)) > -1 ? null : error;
    }
  }

  public notZeroValidator(): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
      const error = {};
      error['zero'] = {value: control.value};
      return !control.value || +control.value !== 0 ? null : error;
    }
  }

  public rangeValidator(): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
      if (!control.value) { return null };
      const error = {};
      error['range'] = {value: control.value};
      try {
        const _value = this.toWei(control.value);
        return _value.gt(this.toWei('0')) && _value.lt(this.utils.toBN('2').pow(this.utils.toBN('256'))) ? null : error;
      } catch (e) {
        return error;
      }
    }
  }

  public toWei(value) {
    const utils = this.web3.utils;
    return utils.toBN(utils.toWei(value, 'ether'));
  }

  public fromWei(value) {
    const utils = this.web3.utils;
    return utils.fromWei(String(value), 'ether');
  }

  public to1E18(value) {
    return this.utils.toWei(value, 'ether');
  }

  public from1E18(value) {
    return this.utils.fromWei(value, 'ether');
  }

  public remove0x(value: string) {
    return value.slice(2, value.length);
  }

  public add0x(value) {
    return '0x' + value;
  }
}

