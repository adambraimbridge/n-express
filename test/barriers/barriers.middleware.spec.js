'use strict';
/*global describe, it, before, afterEach, after*/
var express = require('express');
var sinon = require('sinon');
var request = require('supertest');
var expect = require('chai').expect;
var mockery = require('mockery');
var fetchres = require('fetchres');

var middleware;

describe('Barriers Middleware', function(){

	var app, routeHandler, routeHandlerSpy, locals, server;

	var barriersFlag = true;
	var firstClickFreeFlag = false;
	var metricsMock = {count:sinon.spy()};
	var apiClientMock = {
		getBarrierData : sinon.stub().returns(Promise.resolve(require('../fixtures/barrierData.json')))
	};
	var nodeBeaconMock = {
		fire : sinon.spy()
	};

	before(function(){
		mockery.registerMock('./barrierAPIClient', apiClientMock);
		mockery.registerMock('next-beacon-node-client', nodeBeaconMock);
		mockery.enable({warnOnUnregistered:false, useCleanCache: true});
		middleware = require('../../src/barriers/middleware')(metricsMock);
		app = express();
		routeHandler = function(req, res){
			locals = res.locals;
			res.status(200).end();
		};
		routeHandlerSpy = sinon.spy(routeHandler);
		app.use(function(req, res, next){
			res.locals.flags = {barrier:barriersFlag, firstClickFree:firstClickFreeFlag};
			next();
		});
		app.use(middleware);
		app.get('/*', routeHandlerSpy);
		server = app.listen(4444);
	});

	after(function(){
		mockery.disable();
		server.close();
	});

	afterEach(function(){
		routeHandlerSpy.reset();
		barriersFlag = true;
	});

	var barrierType = "PREMIUM",
		sessionId = "kjvbjkvbrv",
		asyc = "dvsvsv",
		countryCode = "GBR",
		contentClassification = "PREMIUM_CONTENT";


	function setup(){
		return request(app)
			.get('/blah')
			.set('X-FT-Auth-Gate-Result', 'DENIED')
			.set('X-FT-Barrier-Type', barrierType)
			.set('X-FT-Session-Token', sessionId)
			.set('X-FT-AYSC', asyc)
			.set('Country-Code', countryCode)
			.set('X-FT-Content-Classification', contentClassification);
	}

	it('Should set barrier property to false if barrier flag is off', function(done){
		barriersFlag = false;
		request(app)
			.get('/blah')
			.set('X-FT-Auth-Gate-Result', 'DENIED')
			.set('X-FT-Barrier-Type', 'PREMIUM')
			.expect(function(){
				expect(locals.barrier).to.be.false;
			})
			.expect(200, done);
	});

	it('Should vary on the X-FT-Anonymous-User header', function(done){
		setup()
			.expect('Vary', /X-FT-Anonymous-User/)
			.expect(200, done);
	});

	it('Should set the barrier property if there is a barrier to show', function(done){
		setup()
			.expect(function(){
				expect(locals.barrier).to.be.truthy;
			})
			.end(done);
	});

	it('Should set barrier property to false if the firstClickFree flag is active', function(done){
		firstClickFreeFlag = true;
		setup()
			.expect(function(){
				expect(locals.barrier).to.be.null;
			})
			.end(done);
	});

	it('Should fire a barrier.shown event when a barrier is shown', function(done){
		firstClickFreeFlag = false;
		setup()
			.expect(function(){
				sinon.assert.called(nodeBeaconMock.fire);
				var args = nodeBeaconMock.fire.lastCall.args;
				expect(args[0]).to.equal('barrier');
				expect(args[1].meta.type).to.equal('shown');
			})
			.end(done);
	});

	it('Should fire a barrier.firstClickFree event when a barrier is deliberately not shown due to first click free', function(done){
		firstClickFreeFlag = true;
		setup()
			.expect(function(){
				sinon.assert.called(nodeBeaconMock.fire);
				var args = nodeBeaconMock.fire.lastCall.args;
				expect(args[0]).to.equal('barrier');
				expect(args[1].meta.type).to.equal('firstClickFree');
			})
			.end(done);
	});

	it('Should fire a barrier.disabled event when a barrier is deliberately not shown due to the flag being off', function(done){
		firstClickFreeFlag = false;
		barriersFlag = false;
		setup()
			.expect(function(){
				sinon.assert.called(nodeBeaconMock.fire);
				var args = nodeBeaconMock.fire.lastCall.args;
				expect(args[0]).to.equal('barrier');
				expect(args[1].meta.type).to.equal('disabled');
			})
			.end(done);
	});

	it('Should fire a barrier.failover event when a barrier is not shown due to an error', function(done){
		firstClickFreeFlag = false;
		barriersFlag = true;
		var err = new fetchres.BadServerResponseError('BadServerResponseError');
		console.log((err instanceof fetchres.BadServerResponseError));
		apiClientMock.getBarrierData.returns(Promise.reject(err));
		setup()
			.expect(function(){
				sinon.assert.called(nodeBeaconMock.fire);
				var args = nodeBeaconMock.fire.lastCall.args;
				expect(args[0]).to.equal('barrier');
				expect(args[1].meta.type).to.equal('failover');
			})
			.end(done);
	});
});
